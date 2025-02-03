const helpers = require('./helpers/test.helpers');

let userCount = 0;
let randomString = helpers.getRandomString();

exports.beforeSignup = (req, context, _events, next) => {
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
  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/public/complete-signup`;
  req.json = {
    email: helpers.getEmail(randomString, userCount),
    firstName: "LoadTestUser",
    lastName: "LoadTestUser",
    companyQuery: "",
    selectedCompany: null,
    consent: true,
    customRole: "",
    selectedRole: {
      "id": "IndividualInvestor",
      "type": "individual"
    },
  }
  userCount++;

  return next();
};

exports.afterSignup = (_req, res, context, _events, next) => {
  context.vars['setPasswordCode'] = res.body.setPasswordCode;

  return next();
}

exports.beforeSetPassword = (req, context, _events, next) => {
  const setPasswordCode = context.vars.setPasswordCode;
  req.url = `https://stage.identity.q4inc.com/oauth/auth?client_id=q4-public-events-client&redirect_uri=https%3A%2F%2Fconnect.stage.q4inc.com%2Finternal%2Fpublic-users-testing&response_type=code&prompt=resetPassword&userCode=${setPasswordCode}`

  return next();
}

exports.beforeCompleteSetPassword = (req, context, _events, next) => {
  const store = context._jar._jar.store.idx["stage.identity.q4inc.com"];
  console.log("beforeCompleteSetPassword CONTEXT", context);

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

  const setPasswordCode = context.vars.setPasswordCode;
  console.log("beforeCompleteSetPassword context.vars.setPasswordCode", setPasswordCode);

  req.headers.Cookie = cookies;
  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/set-password/complete`;
  req.json = {
    code: setPasswordCode,
    password: helpers.getPassword()
  }

  return next();
}
