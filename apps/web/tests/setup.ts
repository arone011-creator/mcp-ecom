// tests/setup.ts

import { beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

// Installed but never wired up, so toBeInTheDocument and friends did not
// exist on expect().
import '@testing-library/jest-dom';

// Global test setup and configuration

// Mock Prisma Client
export const prismaMock =
  mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

// Mock NextAuth
jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
    getAll: jest.fn(),
    has: jest.fn(),
  }),
  usePathname: () => '/test-path',
}));

// React's hooks were mocked here as bare jest.fn()s, which return
// undefined -- so `const [x, setX] = useState(...)` threw and no stateful
// component could be rendered in a test at all. Nothing depended on the
// mock; the existing suites only render static JSX. Removed so component
// behaviour can actually be tested.

// Mock environment variables
(process.env as any).NODE_ENV = 'test';
(process.env as any).DATABASE_URL =
  'postgresql://test:test@localhost:5432/test_db';
(process.env as any).NEXTAUTH_SECRET = 'test-secret';
(process.env as any).NEXTAUTH_URL = 'http://localhost:3000';

// Mock window object for browser-specific tests (only in jsdom environment)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'location', {
    value: {
      href: 'http://localhost:3000',
      origin: 'http://localhost:3000',
      pathname: '/',
      search: '',
      hash: '',
      assign: jest.fn(),
      replace: jest.fn(),
      reload: jest.fn(),
    },
    writable: true,
  });

  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    },
    writable: true,
  });
}

Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
  writable: true,
});

// Mock fetch API
global.fetch = jest.fn();

// FormData was mocked here with jest.fn()s, so set() did nothing and
// get() returned undefined -- any server action reading a form field was
// untestable. Node's built-in FormData is used instead.

// Mock File API
global.File = jest.fn().mockImplementation((bits, name, options) => ({
  name,
  size: bits.length,
  type: options?.type || '',
  lastModified: Date.now(),
  slice: jest.fn(),
  stream: jest.fn(),
  text: jest.fn(),
  arrayBuffer: jest.fn(),
}));

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'mocked-object-url');
global.URL.revokeObjectURL = jest.fn();

// jsdom ships no TextEncoder/TextDecoder, and anything that reads a
// streamed response needs them -- the assistant provider decodes SSE
// chunks. Node's own implementations, not a mock: this is a gap in the
// environment rather than a dependency to fake.
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Test utilities
export const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  role: 'customer',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createMockProduct = (overrides = {}) => ({
  id: 'product-123',
  name: 'Test Product',
  slug: 'test-product',
  description: 'A test product',
  price: 29.99,
  categoryId: 'category-123',
  images: ['test.jpg'],
  inStock: true,
  sku: 'TEST-001',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createMockOrder = (overrides = {}) => ({
  id: 'order-123',
  userId: 'user-123',
  status: 'pending',
  total: 59.98,
  subtotal: 59.98,
  tax: 0,
  shipping: 0,
  currency: 'USD',
  paymentStatus: 'paid',
  paymentMethod: 'demo',
  createdAt: new Date(),
  updatedAt: new Date(),
  shippingAddress: {
    firstName: 'John',
    lastName: 'Doe',
    address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    zipCode: '12345',
    country: 'US',
  },
  items: [],
  ...overrides,
});

// Setup fetch mock helper
export const mockFetchResponse = (data: any, status = 200) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Map([['content-type', 'application/json']]),
  });
};

// Setup local storage mock helper
export const mockLocalStorage = (data: Record<string, string> = {}) => {
  const storage: Record<string, string> = { ...data };

  (window.localStorage.getItem as jest.Mock).mockImplementation(
    key => storage[key] || null
  );
  (window.localStorage.setItem as jest.Mock).mockImplementation(
    (key, value) => {
      storage[key] = value;
    }
  );
  (window.localStorage.removeItem as jest.Mock).mockImplementation(key => {
    delete storage[key];
  });
  (window.localStorage.clear as jest.Mock).mockImplementation(() => {
    Object.keys(storage).forEach(key => delete storage[key]);
  });
};

// Global setup hooks
beforeAll(() => {
  // Set timezone to UTC for consistent date testing
  process.env.TZ = 'UTC';

  // Suppress console errors during tests unless needed
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  // Cleanup any global state
  jest.restoreAllMocks();
});

beforeEach(() => {
  // Reset all mocks before each test
  mockReset(prismaMock);
  jest.clearAllMocks();

  // Reset fetch mock
  (global.fetch as jest.Mock).mockClear();

  // Clear local storage mock
  (window.localStorage.clear as jest.Mock).mockClear();
  (window.localStorage.getItem as jest.Mock).mockClear();
  (window.localStorage.setItem as jest.Mock).mockClear();
  (window.localStorage.removeItem as jest.Mock).mockClear();
});

afterEach(() => {
  // Clean up any test-specific state
  jest.useRealTimers();
});

// TypeScript type extensions
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeValidEmail(): R;
    }
  }
}

// Custom matchers
(expect as any).extend({
  toBeValidUUID(received: string) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },

  toBeValidEmail(received: string) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = emailRegex.test(received);

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid email`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid email`,
        pass: false,
      };
    }
  },
});

// Cleanup function for integration tests
export const cleanup = () => {
  // Reset database state if needed
  // Clear any external API mocks
  // Reset global state
};

export default {};

// next-auth's useSession throws outside a <SessionProvider>, and most
// component tests render a component tree without one -- they were
// written before anything in that tree asked who was signed in.
//
// DEFAULTS TO SIGNED IN, deliberately: that is the state those tests were
// written to exercise, so the default keeps them meaning what they meant.
// A test about the signed-out case mocks this module itself, which
// overrides this for that file.
jest.mock('next-auth/react', () => ({
  ...jest.requireActual('next-auth/react'),
  useSession: () => ({
    data: { user: { email: 'customer@example.com' } },
    status: 'authenticated',
  }),
}));
