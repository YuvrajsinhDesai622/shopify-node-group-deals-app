require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');


const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Product Schema
const productSchema = new mongoose.Schema({
  shopifyId: String,
  title: String,
  price: Number,
  handle: String,
  image: String
});

// app.get('/', async (req, res) => {
//   res.send(process.env.SHOPIFY_STORE);
// })

// Combo Offer Schema
const comboOfferSchema = new mongoose.Schema({
  name: String,
  shopifyProductIds: [String],
  comboPrice: Number,
  selectableQuantity: Number,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const ComboOffer = mongoose.model('ComboOffer', comboOfferSchema);

// Sync products from Shopify
app.get('/api/sync-products', async (req, res) => {
  try {
    const response = await axios.get(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/products.json`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
        }
      }
    );

    await Promise.all(response.data.products.map(async (product) => {
      await Product.findOneAndUpdate(
        { shopifyId: product.id.toString() },
        {
          shopifyId: product.id.toString(),
          title: product.title,
          price: product.variants[0].price,
          handle: product.handle,
          image: product.images[0]?.src || ''
        },
        { upsert: true }
      );
    }));

    res.json({ success: true, message: 'Products synced successfully' });
  } catch (error) {
    console.error('Error syncing products:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// Create a new combo offer
app.post('/api/combo-offers', async (req, res) => {
  try {
    const { name, productIds, comboPrice, selectableQuantity } = req.body;
    
    // Create combo in MongoDB
    const combo = new ComboOffer({
      name,
      shopifyProductIds: productIds,
      comboPrice,
      selectableQuantity
    });
    
    await combo.save();
    
    // Update Shopify products with combo metafield
    await updateShopifyMetafields(combo);
    
    res.status(201).json({ success: true, combo });
  } catch (error) {
    console.error('Error creating combo:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all combo offers
app.get('/api/combo-offers', async (req, res) => {
  try {
    const combos = await ComboOffer.find();
    res.json({ comboOffers: combos });
  } catch (err) {
    console.error('Error fetching combos:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// Helper function to update Shopify metafields
async function updateShopifyMetafields(combo) {
  const metafield = {
    namespace: "combo_offers",
    key: combo._id.toString(),
    value: JSON.stringify({
      name: combo.name,
      productIds: combo.shopifyProductIds,
      comboPrice: combo.comboPrice,
      selectableQuantity: combo.selectableQuantity
    }),
    type: "json"
  };

  // Add metafield to each product in the combo
  await Promise.all(combo.shopifyProductIds.map(async (productId) => {
    try {
      await axios.post(
        `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/products/${productId}/metafields.json`,
        { metafield },
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error(`Error updating metafield for product ${productId}:`, error);
    }
  }));
}

// Start server
app.listen(process.env.PORT??5000, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});


app.use(cors({
  origin: ['yuvraj-appstore.myshopify.com'],
   methods: ['GET', 'POST'],
  credentials: true
}));
