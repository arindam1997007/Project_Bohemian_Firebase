const functions = require("firebase-functions")
const admin = require("firebase-admin")

var serviceAccount = require("./serviceAccountKey.json")

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const express = require("express")
const cors = require("cors")
const stripe = require("stripe")(functions.config().stripe.secret)

const app = express()
app.use(cors({ origin: "*" }))
app.use(express.json())

// Main Database Reference
const db = admin.firestore()

app.post("/payment/create", async (req, res) => {
  try {
    const cartItems = req.body.cartItems
    const userId = req.body.userId
    if (cartItems.length) {
      let totalAmount = 0
      for (const item of cartItems) {
        // console.log("item", item)
        const productRef = db.collection("products").doc(item.id)
        const doc = await productRef.get()
        if (doc.exists) {
          totalAmount += parseInt(doc.data().price) * parseInt(item.quantity)
          // console.log("doc exists", doc.data(), totalAmount)
        }
      }
      const itemId = await db.collection(`users/${userId}/orders`).add({
        paymentStatus: "initiated",
        items: cartItems,
        timeStamp: admin.firestore.FieldValue.serverTimestamp(),
      })

      // console.log("total amount", totalAmount)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount * 100,
        currency: "inr",
        metadata: {
          userId,
          itemId: itemId.id,
          // cartItems: JSON.stringify(cartItems),
        },
      })

      res.status(200).send({
        clientSecret: paymentIntent.client_secret,
      })
      return
    }

    res.status(400).json({
      message: "No items found",
    })
    return
    // res.status(200).send({
    //   clientSecret: paymentIntent.client_secret,
    // })
  } catch (err) {
    res.status(500).json({ message: err.message, statusCode: 500 })
  }
})

app.get("*", (req, res) => res.status(400).json({ message: "Not Found!" }))

app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"]
  console.log("hello")
  let event = req.body

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      functions.config().stripe.endpointSecret
    )
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`)
  }
  switch (event.type) {
    case "payment_intent.succeeded":
      const metadata = event.data.object.metadata
      // Then define and call a method to handle the successful payment intent.
      // handlePaymentIntentSucceeded(paymentIntent);
      const orderRef = db
        .collection(`users/${metadata.userId}/orders`)
        .doc(metadata.itemId)

      const confirmPayment = await orderRef.set(
        {
          paymentStatus: "completed",
        },
        { merge: true }
      )
      console.log("confirmPayment", confirmPayment)
      break
    default:
      console.log(`Unhandled event type ${event.type}`)
  }
  res.json({ received: true })
})

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// exports.helloWorld = functions.https.onRequest((request, response) => {
//   response.send("Hello world from my first node server")
// })

exports.api = functions.https.onRequest(app)
