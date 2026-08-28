// server/queries/orders.ts
import prisma from '@/lib/prisma';
import { createCachedFunction, CACHE_TAGS } from '@/lib/cache';
import { getCurrentUser } from '@/lib/roles';
import { hasPermission, PERMISSIONS } from '@/lib/roles';

// Alias for getOrder. The previous signature took a `userId` it never
// used, which read as though callers could pass an owner to check
// against; getOrder derives the caller from the session instead.
export const getOrderById = (orderId: string) => getOrder(orderId);

// NOT cached, deliberately. createCachedFunction passes `undefined` as
// unstable_cache's keyParts, so the cache key is derived from the
// function's arguments alone. Neither of the two functions below takes a
// user -- they resolve the caller from the session -- so a shared cache
// entry would serve one user's orders to the next caller. Next.js
// currently refuses to run them at all ("used headers inside a function
// cached with unstable_cache"), which is the only thing that has been
// preventing that leak (finding 46).
export const getOrders = async (page = 1, limit = 20, status?: string) => {
  const skip = (page - 1) * limit;
  const canViewAll = await hasPermission(PERMISSIONS.ORDER_READ_ALL);

  let where: any = {};

  if (!canViewAll) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Authentication required');
    where.userId = user.id;
  }

  if (status) {
    where.status = status;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                images: true,
                slug: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

export const getOrder = async (orderId: string) => {
  const canViewAll = await hasPermission(PERMISSIONS.ORDER_READ_ALL);
  const user = await getCurrentUser();

  const where: any = { id: orderId };

  // Previously this only narrowed to the caller's own orders when a
  // user was present, so an anonymous caller fell through with no
  // ownership filter and could read any order by id. The page is behind
  // middleware, but M2's API layer calls this directly.
  if (!canViewAll) {
    if (!user) return null;
    where.userId = user.id;
  }

  // findFirst, not findUnique: `userId` is not part of a unique
  // constraint, so the ownership filter does not belong in a
  // findUnique where clause.
  return await prisma.order.findFirst({
    where,
    include: {
      orderItems: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              images: true,
              slug: true,
              price: true,
              sku: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
};

export const getUserOrders = createCachedFunction(
  async (userId: string, page = 1, limit = 10) => {
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  images: true,
                  slug: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.order.count({ where: { userId } }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  },
  [CACHE_TAGS.orders],
  60
);

export const getRecentOrders = createCachedFunction(
  async (limit = 10) => {
    // Authentication checked by hasPermission
    const canViewAll = await hasPermission(PERMISSIONS.ORDER_READ_ALL);

    let where: any = {};

    if (!canViewAll) {
      const user = await getCurrentUser();
      if (!user) throw new Error('Authentication required');
      where.userId = user.id;
    }

    return await prisma.order.findMany({
      where,
      include: {
        orderItems: {
          select: {
            id: true,
            quantity: true,
            price: true,
            product: {
              select: {
                id: true,
                name: true,
                images: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });
  },
  [CACHE_TAGS.orders],
  60
);

export const getOrdersByStatus = createCachedFunction(
  async (status: string) => {
    const canViewAll = await hasPermission(PERMISSIONS.ORDER_READ_ALL);

    let where: any = { status };

    if (!canViewAll) {
      const user = await getCurrentUser();
      if (!user) throw new Error('Authentication required');
      where.userId = user.id;
    }

    return await prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                images: true,
                slug: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  },
  [CACHE_TAGS.orders],
  60
);

export const getOrderStatistics = createCachedFunction(
  async () => {
    const [
      totalOrders,
      pendingOrders,
      processingOrders,
      shippedOrders,
      deliveredOrders,
      cancelledOrders,
      totalRevenue,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.count({ where: { status: 'PROCESSING' } }),
      prisma.order.count({ where: { status: 'SHIPPED' } }),
      prisma.order.count({ where: { status: 'DELIVERED' } }),
      prisma.order.count({ where: { status: 'CANCELLED' } }),
      prisma.order.aggregate({
        where: {
          status: { in: ['PROCESSING', 'SHIPPED', 'DELIVERED'] },
        },
        _sum: { total: true },
      }),
    ]);

    return {
      total: totalOrders,
      pending: pendingOrders,
      processing: processingOrders,
      shipped: shippedOrders,
      delivered: deliveredOrders,
      cancelled: cancelledOrders,
      revenue: totalRevenue._sum.total || 0,
    };
  },
  [CACHE_TAGS.orders],
  300 // 5 minutes
);

export const getOrdersByDateRange = createCachedFunction(
  async (startDate: Date, endDate: Date) => {
    // Authentication checked by hasPermission
    const canViewAll = await hasPermission(PERMISSIONS.ORDER_READ_ALL);

    let where: any = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (!canViewAll) {
      const user = await getCurrentUser();
      if (!user) throw new Error('Authentication required');
      where.userId = user.id;
    }

    return await prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                images: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  },
  [CACHE_TAGS.orders],
  300
);

export const getOrderAnalytics = createCachedFunction(
  async (period: 'day' | 'week' | 'month' = 'month') => {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const [orders, revenue] = await Promise.all([
      prisma.order.findMany({
        where: {
          createdAt: { gte: startDate },
        },
        select: {
          createdAt: true,
          total: true,
          status: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startDate },
          status: { in: ['PROCESSING', 'SHIPPED', 'DELIVERED'] },
        },
        _sum: { total: true },
      }),
    ]);

    // Group orders by date
    const ordersByDate = orders.reduce(
      (acc, order) => {
        const date = order.createdAt.toDateString();
        if (!acc[date]) {
          acc[date] = { count: 0, revenue: 0 };
        }
        acc[date].count++;
        if (['PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
          acc[date].revenue += Number(order.total);
        }
        return acc;
      },
      {} as Record<string, { count: number; revenue: number }>
    );

    return {
      totalRevenue: revenue._sum.total || 0,
      totalOrders: orders.length,
      ordersByDate,
    };
  },
  [CACHE_TAGS.orders],
  300
);
