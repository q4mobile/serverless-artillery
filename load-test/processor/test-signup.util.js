const helpers = require('./helpers/test.helpers');

let userCounter = 0;
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
    email: `jess.gold+loadtest.${randomString}.${userCounter}@q4inc.com`,
    password: "!q4Inc1234",
    firstName: `LoadTestUser`,
    lastName: `LoadTestUser`,
    role: "Individual Investor",
    company: "Q4 Inc",
    job: "Software Developer",
    type: "individual",
    institutionId: "43e4cb41-ae68-44b3-90c5-fb0e16dfba04",
  }

  userCounter++;

  return next();
};

exports.afterSignup = (_req, res, context, _events, next) => {
  context.vars['emailVerificationCode'] = res.body.emailVerificationCode;

  return next();
}

exports.beforeSetPassword = (req, context, _events, next) => {
  const emailVerificationCode = context.vars.emailVerificationCode;
  req.url = `https://stage.identity.q4inc.com/oauth/auth?client_id=q4-public-events-client&redirect_uri=https%3A%2F%2Fconnect.stage.q4inc.com%2Finternal%2Fpublic-users-testing&response_type=code&prompt=resetPassword&userCode=${emailVerificationCode}`

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

  const emailVerificationCode = context.vars.emailVerificationCode;
  console.log("beforeCompleteSetPassword context.vars.emailVerificationCode", emailVerificationCode);

  req.headers.Cookie = cookies;
  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/set-password/complete`;
  req.json = {
    code: emailVerificationCode,
    password: "!q4Inc1234"
  }

  return next();
}
