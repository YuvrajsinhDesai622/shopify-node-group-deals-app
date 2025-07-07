require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// app.get('/', async (req, res) => {
//   res.send(process.env.SHOPIFY_STORE);
// })

// Product Schema
const productSchema = new mongoose.Schema({
  shopifyId: String,
  title: String,
  price: Number,
  handle: String,
  image: String,
  isDummyProduct: {
    type: Boolean,
    default: false,
  },
});

// Combo Offer Schema
const comboOfferSchema = new mongoose.Schema({
  name: String,
  shopifyProductIds: [String],
  comboPrice: Number,
  comboVariantId: String,
  selectableQuantity: Number,
  comboImg: String,
  isDummyProduct: { type: Boolean, default: true },
  shopifyComboProductId: String,
  comboType: {
    type: String,
    enum: ["normalCombo", "categorizedCombo"],
    required: true,
  },
  categories: [
    {
      name: String,
      selectableQuantity: Number,
      productIds: [String], // selected productIds per category
    },
  ],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

const Product = mongoose.model("Product", productSchema);
const ComboOffer = mongoose.model("ComboOffer", comboOfferSchema);

// Sync products from Shopify
app.get("/api/sync-products", async (req, res) => {
  try {
    const response = await axios.get(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/products.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    
    await Promise.all(
      response.data.products.map(async (product) => {
        await Product.findOneAndUpdate(
          { shopifyId: product.id.toString() },
          {
            shopifyId: product.id.toString(),
            title: product.title,
            price: product.variants[0].price,
            handle: product.handle,
            image: product.images[0]?.src || "",
          },
          { upsert: true }
        );
      })
    );

    res.json({ success: true, message: "Products synced successfully" });
  } catch (error) {
    console.error("Error syncing products:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all products
app.get("/api/products", async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all combo offers
app.get("/api/combo-offers", async (req, res) => {
  try {
    const combos = await ComboOffer.find();
    res.json({ comboOffers: combos });
  } catch (err) {
    console.error("Error fetching combos:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete("/api/combo-offers-delete/:id", async (req, res) => {
  try {
    const combo = await ComboOffer.findById(req.params.id);
    console.log("shopifyComboProductId", combo.shopifyComboProductId);
    if (!combo) {
      return res
        .status(404)
        .json({ success: false, message: "Combo offer not found" });
    }
    if (combo.shopifyComboProductId) {
      try {
        await axios.delete(
          `https://${process.env.SHOPIFY_STORE}/admin/api/2024-04/products/${combo.shopifyComboProductId}.json`,
          {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (shopifyErr) {
        console.warn(
          "Shopify product deletion failed:",
          shopifyErr.response?.data || shopifyErr.message
        );
      }
    }

    await ComboOffer.findByIdAndDelete(req.params.id);

    // await Product.findOneAndDelete({ shopifyId: combo.shopifyComboProductId });

    res.json({
      success: true,
      message: "Combo offer deleted from MongoDB and Shopify",
    });
  } catch (error) {
    console.error("Error deleting combo:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

async function createComboProductInShopify(comboName, comboPrice) {
  const payload = {
    product: {
      title: comboName,
      product_type: "combo",
      status: "active",
      published_scope: "web",
      tags: ["combo-offer", "combo-hidden"],
      variants: [
        {
          price: comboPrice.toString(),
          option1: "Default Title",
          inventory_management: "shopify",
          inventory_quantity: 999,
        },
      ],
    },
  };

  const response = await axios.post(
    `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/products.json`,
    payload,
    {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    }
  );

  const product = response.data.product;
  return {
    productId: product.id.toString(),
    variantId: product.variants[0].id.toString(),
  };
}

// app.post("/api/combo-offers", async (req, res) => {
//   try {
//     const { name, productIds, comboPrice, selectableQuantity , comboImg } = req.body;

//     // const comboVariantId = await createComboProductInShopify(name, comboPrice);
//     const { productId, variantId } = await createComboProductInShopify(name, comboPrice);

//     const combo = new ComboOffer({
//       name,
//       shopifyProductIds: productIds,
//       comboPrice,
//       comboImg,
//       selectableQuantity,
//       isDummyProduct: true,
//       comboVariantId: variantId,
//       shopifyComboProductId: productId,
//     });

//     await combo.save();

//     await Product.findOneAndUpdate(
//       { shopifyId: productId },
//       { isDummyProduct: true },
//       { upsert: true }
//     );
//     // Optional: Update metafields
//     await updateShopifyMetafields(combo);

//     res.status(201).json({ success: true, combo });
//   } catch (error) {
//     console.error("Error creating combo:", error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// });

app.post("/api/combo-offers", async (req, res) => {
  try {
    const {
      name,
      productIds,
      comboPrice,
      selectableQuantity,
      comboImg,
      categories,
      comboType,
    } = req.body;

    const { productId, variantId } = await createComboProductInShopify(
      name,
      comboPrice
    );

    let comboData: any = {
      name,
      comboPrice,
      comboImg,
      comboType,
      isDummyProduct: true,
      comboVariantId: variantId,
      shopifyComboProductId: productId,
    };

    if (comboType === "normalCombo") {
      comboData.shopifyProductIds = productIds;
      comboData.selectableQuantity = selectableQuantity;
    } else if (comboType === "categorizedCombo") {
      comboData.categories = categories;
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid combo type." });
    }

    const combo = new ComboOffer(comboData);
    await combo.save();

    await Product.findOneAndUpdate(
      { shopifyId: productId },
      { isDummyProduct: true },
      { upsert: true }
    );

    await updateShopifyMetafields(combo);

    res.status(201).json({ success: true, combo });
  } catch (error) {
    console.error("Error creating combo:", error);
    res.status(500).json({ success: false, message: error.message });
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
      selectableQuantity: combo.selectableQuantity,
    }),
    type: "json",
  };

  // Add metafield to each product in the combo
  await Promise.all(
    combo.shopifyProductIds.map(async (productId) => {
      try {
        await axios.post(
          `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/products/${productId}/metafields.json`,
          { metafield },
          {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (error) {
        console.error(
          `Error updating metafield for product ${productId}:`,
          error
        );
      }
    })
  );
}

app.listen(process.env.PORT ?? 5000, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});

app.use(
  cors({
    origin: ["yuvraj-appstore.myshopify.com"],
    methods: ["GET", "POST"],
    credentials: true,
  })
);
