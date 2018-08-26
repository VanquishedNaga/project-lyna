const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();

// const cors = require('cors')({
//   origin: true,
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

exports.processRestock = functions.https.onCall((data, context) => {
	const key = data.key;
	const action = data.action;

	// Update request status
	admin.database().ref('/productRequests/' + key).update({status:action});

	if (action == 'Approved') {
		// Retrieve restock request data
		admin.database().ref('/productRequests/' + key).once('value', (snapshot) => {
			var quantity = snapshot.val().quantity;
			var requestor = snapshot.val().requestor;
			var upline = snapshot.val().upline;
			var product = snapshot.val().productID;

			//Get and update requestor inventory quantity
			var updateRequestorInventory = admin.database().ref('/users/' + requestor + '/inventory/' + product);
			updateRequestorInventory.transaction(function(currentProduct) {
				var total = currentProduct + parseFloat(quantity);
				return currentProduct + parseFloat(quantity);
			});

			//Get and update upline inventory quantity
			var updateUplineInventory = admin.database().ref('/users/' + upline + '/inventory/' + product);
			updateUplineInventory.transaction(function(currentProduct) {
				return currentProduct - quantity;
			});
		});
	}
});

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });