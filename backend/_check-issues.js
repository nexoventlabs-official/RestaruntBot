/**
 * Check what issues the 120 items have in Commerce Manager
 */
require('dotenv').config();
const axios = require('axios');

async function checkIssues() {
  const token = process.env.META_ACCESS_TOKEN;
  const catalogId = process.env.META_CATALOG_ID;

  // Check catalog diagnostics for errors
  console.log('=== Catalog Diagnostics ===');
  try {
    const resp = await axios.get(
      `https://graph.facebook.com/v24.0/${catalogId}/diagnostics`,
      { params: { fields: 'category,subcategory,title,description,affected_items_count,severity' }, headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.log('Error:', e.response?.data?.error?.message || e.message);
  }

  // Check products with errors field
  console.log('\n=== Products with errors (first 5) ===');
  try {
    const resp = await axios.get(
      `https://graph.facebook.com/v24.0/${catalogId}/products`,
      { 
        params: { 
          fields: 'retailer_id,name,price,image_url,url,review_status,errors,visibility',
          limit: 5
        },
        headers: { Authorization: `Bearer ${token}` } 
      }
    );
    resp.data.data.forEach(p => {
      console.log(`\n${p.name} (${p.retailer_id}):`);
      console.log(`  price: ${p.price}, visibility: ${p.visibility}, review: ${p.review_status}`);
      console.log(`  image_url: ${p.image_url || 'MISSING'}`);
      console.log(`  url: ${p.url || 'MISSING'}`);
      if (p.errors && p.errors.length > 0) {
        console.log(`  ERRORS:`, JSON.stringify(p.errors));
      }
    });
  } catch (e) {
    console.log('Error:', e.response?.data?.error?.message || e.message);
  }

  // Check items with issues specifically
  console.log('\n=== Check items_batch upload status ===');
  try {
    const resp = await axios.get(
      `https://graph.facebook.com/v24.0/${catalogId}/check_batch_request_status`,
      { 
        params: { handle: 'last' },
        headers: { Authorization: `Bearer ${token}` } 
      }
    );
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.log('Status check error:', e.response?.data?.error?.message || e.message);
  }

  // Check product feed uploads for error details
  console.log('\n=== Product feed uploads ===');
  try {
    const resp = await axios.get(
      `https://graph.facebook.com/v24.0/${catalogId}/product_feeds`,
      { 
        params: { fields: 'id,name,product_count,latest_upload' },
        headers: { Authorization: `Bearer ${token}` } 
      }
    );
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.log('Error:', e.response?.data?.error?.message || e.message);
  }

  // Try to get product with all possible fields to find what's missing
  console.log('\n=== Full product detail (Appalam) ===');
  try {
    const resp = await axios.get(
      `https://graph.facebook.com/v24.0/33947641554850115`,
      { 
        params: { fields: 'id,retailer_id,name,description,price,currency,availability,condition,visibility,review_status,image_url,url,brand,category,errors,additional_image_urls' },
        headers: { Authorization: `Bearer ${token}` } 
      }
    );
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.log('Error:', e.response?.data?.error?.message || e.message);
  }
}

checkIssues().catch(console.error);
