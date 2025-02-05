const helpers = require('./helpers/test.helpers');

let testRunCount = 1;
let randomString = helpers.getRandomString();

exports.beforeLogin = (req, context, _events, next) => {
  const store = context._jar._jar.store.idx["stage.identity.q4inc.com"];

  const interactionId = helpers.getInteractionId(store);
  if (!interactionId) {
    console.error("Interaction id not found");
    return next();
  }
  console.log("Interaction Id", interactionId);

  const cookies = helpers.getCookies(store, interactionId);
  if (!cookies) {
    console.error("Cookies not found");
    return next();
  }
  console.log("cookies", cookies);

  req.headers.Cookie = cookies;
  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/login/complete`;
  req.json = {
    username: helpers.getEmail(randomString, testRunCount++),
    password: helpers.getPassword(),
    isRememberUsername: false
  }

  return next();
};
