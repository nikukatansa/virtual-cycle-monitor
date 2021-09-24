import firebase from 'firebase/app'

export default () => {
  if (!firebase.apps.length) {
    firebase.initializeApp({
      apiKey: "AIzaSyDL8a9C5nB9GnlYI0DB22hWqclSNWG5wbg",
      authDomain: "virtual-cycle.firebaseapp.com",
      projectId: "virtual-cycle",
      storageBucket: "virtual-cycle.appspot.com",
      messagingSenderId: "370679069938",
      appId: "1:370679069938:web:988efa993793b4dc1c246b"
    })
  }
}
