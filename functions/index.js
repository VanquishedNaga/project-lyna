const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();

exports.processRestockRequestFunction = functions.https.onCall((data, context) => {
  const key = data.key;
  const action = data.action;
  const privilege = data.privilege;

  admin.database().ref('/productRequests/' + key).once('value', (snapshot) => {
    var status = snapshot.val().status;

    // Only proceed if the action has not been done.
    if ((status != action) && (status != 'Approved')) {
      // Check if payment proof was uploaded
      if (snapshot.hasChild('payProof')) {
        // Delete the photo
        var imagePath = snapshot.val().payProof.path;
        admin.storage().bucket().file(imagePath).delete();
        admin.database().ref('/productRequests/' + key + '/payProof').remove();
      }

      // Update request status.
      admin.database().ref('/productRequests/' + key).update({status:action});

      if (action == 'Approved') {
        // Retrieve restock request data
        admin.database().ref('/productRequests/' + key).once('value', (snapshot) => {
          var quantity = snapshot.val().quantity;
          var requestor = snapshot.val().requestor;
          var upline = snapshot.val().upline;
          var product = snapshot.val().productID;
          var payable = snapshot.val().payable;

          // Get and update requestor inventory quantity
          var updateRequestorInventory = admin.database().ref('/users/' + requestor + '/inventory/' + product);
          updateRequestorInventory.transaction(function(currentProduct) {
            return currentProduct + parseFloat(quantity);
          });

          if (privilege == 'Admin') {
            // Get and update store quantity
            var updateUplineInventory = admin.database().ref('/products/' + product + '/qty/free');
            updateUplineInventory.transaction(function(currentProduct) {
              return currentProduct - parseFloat(quantity);
            });
          }
          else {
            // Get and update upline inventory quantity
            var updateUplineInventory = admin.database().ref('/users/' + upline + '/inventory/' + product);
            updateUplineInventory.transaction(function(currentProduct) {
              return currentProduct - parseFloat(quantity);
            });
          }

          //Get current month and year
          var currentDate = new Date();
          var currentMonth = ((currentDate.getMonth()+1) < 10 ? '0' : '') + (currentDate.getMonth()+1);
          var currentYear = currentDate.getFullYear();

          //Update requestor's cost
          var updateRequestorCost = admin.database().ref('/profit/' + requestor + '/cost/' + currentYear + currentMonth);
          updateRequestorCost.transaction(function(currentCost) {
            return (parseFloat(currentCost || 0) + parseFloat(payable)).toFixed(2);
          });

          //Update upline's revenue
          var updateUplineRevenue = admin.database().ref('/profit/' + upline + '/revenue/' + currentYear + currentMonth);
          updateUplineRevenue.transaction(function(currentRevenue) {
            return (parseFloat(currentRevenue || 0) + parseFloat(payable)).toFixed(2);
          });
        });
      }
    }
  });
});

exports.adminRestockFunction = functions.https.onCall((data, context) => {
  const prodKey = data.prodKey;
  const qty = data.qty;

  var ref = admin.database().ref('/products/' + prodKey + '/qty/total');
  ref.transaction(function(currentTotal) {
    return currentTotal + parseFloat(qty);
  });

  ref = admin.database().ref('/products/' + prodKey + '/qty/free');
  ref.transaction(function(currentFree) {
    return currentFree + parseFloat(qty);
  });
});

exports.addSalesFunction = functions.https.onCall((data, context) => {
  const amount = data.amount;
  const custProfile = data.custProfile;
  const prod = data.prod;
  const qty = data.qty;
  const time = data.time;
  const seller = data.seller;
  const stat = data.stat;

  return admin.database().ref('/common/salesId').transaction(function(id){
    return ++id;
  }).then((id) => {
    admin.database().ref('/sales').push({
      id: id.snapshot.val(),
      amount: amount,
      custProfile: custProfile,
      prod: prod,
      qty: qty,
      time: time,
      seller: seller,
      stat: stat,
    }).then((snap) => {
      var ref = admin.database().ref('/users/' + seller + '/inventory/' + prod);
      ref.transaction(function(currentAmount) {
        return (currentAmount - qty);
      });

      //Get current month and year
      var currentDate = new Date();
      var currentMonth = ((currentDate.getMonth()+1) < 10 ? '0' : '') + (currentDate.getMonth()+1);
      var currentYear = currentDate.getFullYear();

      // Update seller total revenue.
      var updateCurrentRevenue = admin.database().ref('/profit/' + seller + '/revenue/' + currentYear + currentMonth);
      updateCurrentRevenue.transaction(function(currentRevenue) {
        return (parseFloat(currentRevenue || 0) + parseFloat(amount)).toFixed(2);
      });

      return snap.key;
    });
  }).catch((err) => {
    console.log(err);
  })
});

exports.processSalesFunction = functions.https.onCall((data, context) => {
  const key = data.key;
  const action = data.action;

  if (action == 'Processed') {
    // Get sales order details.
    admin.database().ref('/sales/' + key).once('value', (snapshot) => {
      var status = snapshot.val().status;

      // Only proceed if status is not processed already.
      if (status != action && status != 'Rejected') {
        // Update order status.
        admin.database().ref('/sales/' + key).update({stat: action});
      }
    });
  }
  else if ((action == 'Rejected') || (action == 'Cancelled')) {
    // Update order status.
    admin.database().ref('/sales/' + key).update({stat: action});

    // Return amount to seller inventory.
    admin.database().ref('/sales/' + key).once('value', (snapshot) => {
      var amount = snapshot.val().amount || 0;
      var seller = snapshot.val().seller;
      var prod = snapshot.val().prod;
      var qty = snapshot.val().qty || 0;

      admin.database().ref('/users/' + seller + '/inventory/' + prod).transaction(function(currentAmount) {
        return (currentAmount + parseFloat(qty));
      });

      // Update user total revenue.
      admin.database().ref('/users/' + seller + '/revenue').transaction(function(currentAmount) {
        return (parseFloat(currentAmount || 0) - parseFloat(amount)).toFixed(2);
      });
    });
  }
});

// Sends a notifications to all users when a new message is posted.
exports.sendNotifications = functions.database.ref('/messages/{messageId}').onCreate((snapshot) => {
  // Notification details.
  const text = snapshot.val().message;
  const payload = {
    notification: {
      title: `Announcement`,
      body: text ? (text.length <= 100 ? text : text.toString().substring(0, 97) + '...') : '',
      click_action: `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com`,
    }
  };

  let tokens = []; // All Device tokens to send a notification to.
  // Get the list of device tokens.
  return admin.database().ref('tokens').once('value').then((allTokens) => {
    if (allTokens.exists()) {
      // Listing all tokens.
      tokens = Object.keys(allTokens.val());

      // Send notifications to all tokens.
      return admin.messaging().sendToDevice(tokens, payload);
    }
    return {results: []};
  }).then((response) => {
    return cleanupTokens(response, tokens);
  }).then(() => {
    console.log('Notifications have been sent and tokens cleaned up.');
    return null;
  });
});

// Cleans up the tokens that are no longer valid.
function cleanupTokens(response, tokens) {
 // For each notification we check if there was an error.
 const tokensToRemove = {};
 response.results.forEach((result, index) => {
   const error = result.error;
   if (error) {
     console.error('Failure sending notification to', tokens[index], error);
     // Cleanup the tokens who are not registered anymore.
     if (error.code === 'messaging/invalid-registration-token' ||
         error.code === 'messaging/registration-token-not-registered') {
       tokensToRemove[`/fcmTokens/${tokens[index]}`] = null;
     }
   }
 });
 return admin.database().ref().update(tokensToRemove);
}

// When a postage reload request is processed, update user postage balance and remove attached payment proof
exports.processPostageReload = functions.database.ref('/reloadPostageRequests/{requestId}').onWrite((change, context) => {
  var retVal = null;
  // Don't care new request
  if (!change.before.exists()) {
  }
  // Request deleted
  else if (!change.after.exists()) {
    // Delete attached image
    const before = change.before.val();
    if (before.payProof) {
      // Delete the photo
      var imagePath = before.payProof.path;
      admin.storage().bucket().file(imagePath).delete();
    }
  }
  else {
    const before = change.before.val();
    const after = change.after.val();
    if (((after.status == 'Approved') || (after.status == 'Rejected')) && (before.status != after.status)) {
      if (after.status == 'Approved') {
        // Update balance
        admin.database().ref('/users/' + after.uid + '/postage').transaction(function(currentAmount) {
          return (parseFloat(currentAmount || 0) + parseFloat(after.amount)).toFixed(2);
        });

        //Get current month and year
        var currentDate = new Date();
        var currentMonth = ((currentDate.getMonth()+1) < 10 ? '0' : '') + (currentDate.getMonth()+1);
        var currentYear = currentDate.getFullYear();

        //Update user's cost
        var updateRequestorCost = admin.database().ref('/profit/' + after.uid + '/cost/' + currentYear + currentMonth);
        updateRequestorCost.transaction(function(currentCost) {
          return (parseFloat(currentCost || 0) + parseFloat(after.amount)).toFixed(2);
        });
      }

      // Delete attached image
      if (after.payProof) {
        // Delete the photo
        var imagePath = after.payProof.path;
        admin.storage().bucket().file(imagePath).delete();
        admin.database().ref('/reloadPostageRequests/' + context.params.requestId + '/payProof').remove();
      }
    }
  }
  return retVal;
});

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

// Take the text parameter passed to this HTTP endpoint and insert it into the
// Realtime Database under the path /messages/:pushId/original
// exports.addMessage = functions.https.onRequest((req, res) => {
//   // Grab the text parameter.
//   const original = req.query.text;
//   // Push the new message into the Realtime Database using the Firebase Admin SDK.
//   return admin.database().ref('/messages').push({original: original}).then((snapshot) => {
//     // Redirect with 303 SEE OTHER to the URL of the pushed object in the Firebase console.
//     return res.redirect(303, snapshot.ref.toString());
//   });
// });

// // Listens for new messages added to /messages/:pushId/original and creates an
// // uppercase version of the message to /messages/:pushId/uppercase
// exports.makeUppercase = functions.database.ref('/messages/{pushId}/original')
//     .onCreate((snapshot, context) => {
//       // Grab the current value of what was written to the Realtime Database.
//       const original = snapshot.val();
//       console.log('Uppercasing', context.params.pushId, original);
//       const uppercase = original.toUpperCase();
//       // You must return a Promise when performing asynchronous tasks inside a Functions such as
//       // writing to the Firebase Realtime Database.
//       // Setting an "uppercase" sibling in the Realtime Database returns a Promise.
//       return snapshot.ref.parent.child('uppercase').set(uppercase);
//     });
