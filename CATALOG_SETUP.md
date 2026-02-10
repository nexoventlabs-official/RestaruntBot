# WhatsApp Catalog Setup Guide

## Step 1: Create a Catalog in Meta Commerce Manager

1. Go to **[Meta Commerce Manager](https://business.facebook.com/commerce)**
2. Click **"+ Add Catalog"**
3. Select **"E-commerce"** as catalog type
4. Choose **"Upload product info"** method
5. Give your catalog a name (e.g., `Perivi Hotel Menu`)
6. Click **"Create"**

## Step 2: Get Your Catalog ID

Once the catalog is created:

1. Go to **[Meta Commerce Manager](https://business.facebook.com/commerce)**
2. Select your catalog from the left sidebar
3. Look at the **URL** in your browser — it will look like:
   ```
   https://business.facebook.com/commerce/catalogs/123456789012345/...
   ```
4. The number `123456789012345` is your **Catalog ID**

**Alternative method:**

1. Go to **Commerce Manager** → Select your catalog
2. Click **Settings** (gear icon) in the left sidebar
3. Your **Catalog ID** is displayed at the top of the settings page

## Step 3: Link Catalog to WhatsApp Business

1. Go to **[WhatsApp Manager](https://business.facebook.com/wa/manage/home/)**
2. Select your WhatsApp Business Account
3. Go to **Account Tools** → **Catalog**
4. Click **"Connect Catalog"**
5. Select the catalog you created in Step 1
6. Click **"Done"**

> ⚠️ Your Meta Business must be **verified** to use catalog features (yours is already verified ✓)

## Step 4: Add META_CATALOG_ID to .env

Open your backend `.env` file and add:

```env
META_CATALOG_ID=123456789012345
```

Replace `123456789012345` with your actual catalog ID from Step 2.

## Step 5: Initial Product Sync

Once the catalog is connected and `.env` is updated, run the auto-sync to push all your menu items to the catalog:

```bash
# Using the API endpoint (requires admin auth token)
curl -X POST https://your-domain.com/api/catalog/auto-sync \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"overwrite": true}'
```

Or from the browser/Postman:
- **POST** `/api/catalog/auto-sync`
- **Header:** `Authorization: Bearer <your_admin_token>`
- **Body:** `{ "overwrite": true }`

This will:
- Create all menu items as products in your Meta catalog
- Use MongoDB `_id` as the `retailer_id` for each product
- Create local mappings in the database

## How It Works After Setup

| Action | What Happens |
|--------|-------------|
| **Add item** in admin app | Auto-synced to Meta catalog |
| **Edit item** in admin app | Auto-updated in Meta catalog |
| **Delete item** in admin app | Auto-removed from Meta catalog |
| **Pause/Unpause item** | Availability updated in Meta catalog |
| **Customer browses menu** in WhatsApp | Sees catalog product cards with images, prices |
| **Customer adds to cart** in WhatsApp | Uses native WhatsApp cart with quantity picker |
| **Customer submits cart** | Order processed directly into your system |

## Troubleshooting

### Catalog not showing in WhatsApp?
- Ensure the catalog is **linked** to your WhatsApp phone number (Step 3)
- Products need **images** to display properly in WhatsApp
- New products may take **5-10 minutes** to appear in WhatsApp after sync

### Products not syncing?
- Check `META_CATALOG_ID` is set correctly in `.env`
- Check server logs for `Meta createOrUpdateCatalogProduct error`
- Verify your `META_ACCESS_TOKEN` has `catalog_management` permission

### Fallback behavior
If `META_CATALOG_ID` is not set or catalog sync fails, the chatbot automatically falls back to the existing **text list** format — no disruption to service.
