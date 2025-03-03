const helpers = require('./helpers/test.helpers');

let testRunCount = 1;
let testIdentifier = helpers.getTestIdentifier();

exports.beforeCompanySearch = (req, _context, _events, next) => {
  req.url = `https://stage.identity.q4inc.com/search/company?searchText=Vanguard+Group+${testRunCount}`;

  next();
}

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
    email: helpers.getEmail(testIdentifier),
    firstName: "LoadTestUser",
    lastName: "LoadTestUser",
    companyQuery: "",
    consent: true,
    customRole: "",
    selectedCompany: {
      label: "The Vanguard Group, Inc.",
      id: "fe5c459f6a02f9a3beeb5864b7845241"
    },
    selectedRole: {
      id: "CorporateAndEmployee",
      type: "company"
    },
  }

  return next();
};

exports.afterSignup = (_req, res, context, _events, next) => {
  context.vars['setPasswordCode'] = res.body.setPasswordCode;

  return next();
}

exports.beforeSetPassword = (req, context, _events, next) => {
  const setPasswordCode = context.vars.setPasswordCode;
  req.url = `https://stage.identity.q4inc.com/oauth/auth?client_id=q4-public-events-client&redirect_uri=https%3A%2F%2Fconnect.stage.q4inc.com%2Finternal%2Fpublic-users-testing&response_type=code&prompt=createAccount&userCode=${setPasswordCode}`

  return next();
}

exports.beforeCompleteSetPassword = (req, context, _events, next) => {
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

  const setPasswordCode = context.vars.setPasswordCode;

  req.headers.Cookie = cookies;
  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/set-password/complete`;
  req.json = {
    code: setPasswordCode,
    password: helpers.getPassword()
  }

  return next();
}
