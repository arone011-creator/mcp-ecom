-- Product artwork, and a distinct set of products for New Arrivals
-- (2026-09-05).
--
-- A DATA migration rather than a schema one, and that needs justifying.
-- The seed script creates these rows, but it uses create() rather than
-- upsert() and is not run on deploy -- so the deployed database has no
-- product_images rows at all, and every card on the site falls back to a
-- grey "No Image" placeholder. Re-running the seed against it would
-- duplicate every category and product. A migration is the one path that
-- reaches production automatically, exactly once, through the pipeline
-- that already runs (`prisma migrate deploy` in the build).
--
-- PURELY ADDITIVE. Nothing here deletes or overwrites: every statement is
-- an INSERT guarded by NOT EXISTS, or an UPDATE that appends a tag it has
-- checked is absent. Run twice it does nothing the second time.
--
-- IDS ARE READABLE AND FIXED rather than cuid()s. The application never
-- generates ids that look like these, so they cannot collide, and a fixed
-- id is what lets each statement below check whether it has already run.
--
-- CAMELCASE COLUMNS, quoted, because that is what the `products` and
-- `product_images` tables use.

-- 1. Artwork for the five products that already exist.
--
-- Two images each, matching what the seed intends: the main illustration
-- and a colour-swapped variant for the gallery.
INSERT INTO "product_images" ("id", "url", "altText", "position", "productId", "createdAt")
SELECT
    'img_' || p."slug" || '_0',
    '/images/products/' || p."slug" || '.svg',
    p."name" || ' - main image',
    0,
    p."id",
    NOW()
FROM "products" p
WHERE p."slug" IN (
    'iphone-15-pro',
    'macbook-air-m2',
    'samsung-galaxy-s24',
    'premium-cotton-tshirt',
    'wireless-headphones'
)
AND NOT EXISTS (
    SELECT 1 FROM "product_images" i WHERE i."id" = 'img_' || p."slug" || '_0'
);

INSERT INTO "product_images" ("id", "url", "altText", "position", "productId", "createdAt")
SELECT
    'img_' || p."slug" || '_1',
    '/images/products/' || p."slug" || '-alt.svg',
    p."name" || ' - alternate view',
    1,
    p."id",
    NOW()
FROM "products" p
WHERE p."slug" IN (
    'iphone-15-pro',
    'macbook-air-m2',
    'samsung-galaxy-s24',
    'premium-cotton-tshirt',
    'wireless-headphones'
)
AND NOT EXISTS (
    SELECT 1 FROM "product_images" i WHERE i."id" = 'img_' || p."slug" || '_1'
);

-- 2. Mark the original five as featured.
--
-- Featured and New Arrivals used to be the SAME QUERY -- both "newest
-- first" -- so the home page showed one set of products twice under two
-- headings. This tag is what separates them: featured is chosen, new is
-- chronological.
UPDATE "products"
SET "tags" = array_append("tags", 'featured')
WHERE "slug" IN (
    'iphone-15-pro',
    'macbook-air-m2',
    'samsung-galaxy-s24',
    'premium-cotton-tshirt',
    'wireless-headphones'
)
AND NOT ('featured' = ANY("tags"));

-- 3. Six new products, so New Arrivals has something of its own.
--
-- Invented, like everything else in this shop. The names are deliberately
-- not real brands: a dummy catalogue that reads as real is the thing the
-- home page's disclaimer exists to prevent.
--
-- Categories are joined BY SLUG rather than by id, because the ids are
-- cuid()s generated when the database was seeded and are not knowable
-- from here.
INSERT INTO "products" (
    "id", "name", "slug", "description", "content", "price", "comparePrice",
    "trackQuantity", "status", "sku", "tags", "seoTitle", "seoDescription",
    "createdAt", "updatedAt", "categoryId"
)
SELECT v."id", v."name", v."slug", v."description", v."content", v."price",
       v."comparePrice", true, 'PUBLISHED'::"ProductStatus", v."sku",
       v."tags", v."seoTitle", v."seoDescription",
       NOW(), NOW(), c."id"
FROM (
    VALUES
    (
        'prod_aurora_speaker', 'Aurora Smart Speaker', 'aurora-smart-speaker',
        'Room-filling sound with a voice assistant built in.',
        'The Aurora fills a room from a single driver array and answers when spoken to. Six far-field microphones, a fabric shell, and a light ring that glows while it is listening.',
        89.99::DECIMAL(10,2), 109.99::DECIMAL(10,2), 'AUR-SPK-01',
        ARRAY['speaker', 'audio', 'smart-home', 'new'],
        'Aurora Smart Speaker | MCP Commerce',
        'A demo product. Room-filling sound with a voice assistant built in.',
        'electronics'
    ),
    (
        'prod_nimbus_keyboard', 'Nimbus Mechanical Keyboard', 'nimbus-mechanical-keyboard',
        'A quiet mechanical keyboard with a low profile.',
        'Tactile switches damped for an open-plan office, an aluminium plate, and a low-profile case that keeps your wrists flat. Wired or wireless.',
        129.99::DECIMAL(10,2), 159.99::DECIMAL(10,2), 'NIM-KBD-01',
        ARRAY['keyboard', 'desk', 'mechanical', 'new'],
        'Nimbus Mechanical Keyboard | MCP Commerce',
        'A demo product. A quiet mechanical keyboard with a low profile.',
        'electronics'
    ),
    (
        'prod_pulse_band', 'Pulse Fitness Band', 'pulse-fitness-band',
        'A slim tracker for steps, sleep and heart rate.',
        'Seven days on a charge, a screen you can read outdoors, and a strap light enough to forget you are wearing. Tracks steps, sleep stages and heart rate.',
        79.99::DECIMAL(10,2), 99.99::DECIMAL(10,2), 'PLS-BND-01',
        ARRAY['fitness', 'wearable', 'health', 'new'],
        'Pulse Fitness Band | MCP Commerce',
        'A demo product. A slim tracker for steps, sleep and heart rate.',
        'electronics'
    ),
    (
        'prod_terra_planters', 'Terra Ceramic Planter Set', 'terra-ceramic-planter-set',
        'Three glazed planters with drainage trays.',
        'Small, medium and large, thrown in stoneware and glazed in a warm matte clay. Each sits on its own drainage tray, so they can go straight onto a windowsill.',
        34.99::DECIMAL(10,2), 44.99::DECIMAL(10,2), 'TRA-PLT-03',
        ARRAY['garden', 'ceramic', 'home', 'new'],
        'Terra Ceramic Planter Set | MCP Commerce',
        'A demo product. Three glazed planters with drainage trays.',
        'home-garden'
    ),
    (
        'prod_halo_lamp', 'Halo Desk Lamp', 'halo-desk-lamp',
        'An adjustable desk lamp with warm and cool light.',
        'A weighted base, an arm that stays where it is put, and a dial that runs from warm evening light to daylight. Dimmable to almost nothing.',
        44.99::DECIMAL(10,2), 54.99::DECIMAL(10,2), 'HAL-LMP-01',
        ARRAY['lighting', 'desk', 'home', 'new'],
        'Halo Desk Lamp | MCP Commerce',
        'A demo product. An adjustable desk lamp with warm and cool light.',
        'home-garden'
    ),
    (
        'prod_drift_shirt', 'Drift Linen Shirt', 'drift-linen-shirt',
        'A relaxed linen shirt for warm weather.',
        'Washed linen that softens with every wash, cut loose through the body, with a camp collar that sits flat whether it is buttoned or not.',
        59.99::DECIMAL(10,2), 79.99::DECIMAL(10,2), 'DRF-SHT-01',
        ARRAY['clothing', 'linen', 'summer', 'new'],
        'Drift Linen Shirt | MCP Commerce',
        'A demo product. A relaxed linen shirt for warm weather.',
        'mens-clothing'
    )
) AS v ("id", "name", "slug", "description", "content", "price", "comparePrice",
        "sku", "tags", "seoTitle", "seoDescription", "categorySlug")
JOIN "categories" c ON c."slug" = v."categorySlug"
WHERE NOT EXISTS (
    SELECT 1 FROM "products" p WHERE p."slug" = v."slug"
);

-- 4. Artwork for the new products.
INSERT INTO "product_images" ("id", "url", "altText", "position", "productId", "createdAt")
SELECT
    'img_' || p."slug" || '_0',
    '/images/products/' || p."slug" || '.svg',
    p."name" || ' - main image',
    0,
    p."id",
    NOW()
FROM "products" p
WHERE p."slug" IN (
    'aurora-smart-speaker',
    'nimbus-mechanical-keyboard',
    'pulse-fitness-band',
    'terra-ceramic-planter-set',
    'halo-desk-lamp',
    'drift-linen-shirt'
)
AND NOT EXISTS (
    SELECT 1 FROM "product_images" i WHERE i."id" = 'img_' || p."slug" || '_0'
);

INSERT INTO "product_images" ("id", "url", "altText", "position", "productId", "createdAt")
SELECT
    'img_' || p."slug" || '_1',
    '/images/products/' || p."slug" || '-alt.svg',
    p."name" || ' - alternate view',
    1,
    p."id",
    NOW()
FROM "products" p
WHERE p."slug" IN (
    'aurora-smart-speaker',
    'nimbus-mechanical-keyboard',
    'pulse-fitness-band',
    'terra-ceramic-planter-set',
    'halo-desk-lamp',
    'drift-linen-shirt'
)
AND NOT EXISTS (
    SELECT 1 FROM "product_images" i WHERE i."id" = 'img_' || p."slug" || '_1'
);

-- 5. Stock for the new products.
--
-- Without an inventory row check_inventory reports nothing and the card
-- cannot say "In Stock", so a product without one is only half added.
INSERT INTO "inventory" ("id", "quantity", "reserved", "available", "productId", "createdAt", "updatedAt")
SELECT
    'inv_' || p."slug",
    42,
    0,
    42,
    p."id",
    NOW(),
    NOW()
FROM "products" p
WHERE p."slug" IN (
    'aurora-smart-speaker',
    'nimbus-mechanical-keyboard',
    'pulse-fitness-band',
    'terra-ceramic-planter-set',
    'halo-desk-lamp',
    'drift-linen-shirt'
)
AND NOT EXISTS (
    SELECT 1 FROM "inventory" i WHERE i."productId" = p."id"
);
