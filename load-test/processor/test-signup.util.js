let requestCounter = 0;
let emailVerificationCodes = []

function getInteractionId(store) {
  const interactionPath = Object.keys(store).find(path =>
    path.startsWith("/interaction/")
  );

  if (!interactionPath) return null;

  const interactionId = interactionPath.split("/interaction/")[1];
  return interactionId;
}

function getCookies(cookieObj) {
  return Object.keys(cookieObj)
    .map(key => {
      const match = `${cookieObj[key]}`.match(/=(.*?);/);
      return match ? `${key}=${match[1].trim()}` : "";
    })
    .join("; ");
}

exports.beforeSignup = (req, context, _events, next) => {
  const store = context._jar._jar.store.idx["stage.identity.q4inc.com"];
  console.log("CONTEXT", context);

  const interactionId = getInteractionId(store);

  if (!interactionId) {
    console.error("Interaction id not found");
    return next();
  }

  console.log("Interaction Id", interactionId);

  const cookieObj = store[`/interaction/${interactionId}`];
  const cookies = getCookies(cookieObj);

  if (!cookies) {
    console.error("Cookies not found");
    return next();
  }

  console.log("cookies", cookies);

  req.headers.Cookie = cookies;
  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/public/complete-signup`;

  req.json = {
    email: `jess.gold+publicloadtest${requestCounter}@q4inc.com`,
    password: "!q4Inc1234",
    firstName: `Jess-${requestCounter}`,
    lastName: `Gold-${requestCounter}`,
    role: "Individual Investor",
    company: "Q4 Inc",
    job: "Software Developer",
    type: "individual",
    institutionId: "43e4cb41-ae68-44b3-90c5-fb0e16dfba04",
  }

  requestCounter++;

  return next();
};

exports.afterSignup = (req, res, _context, _events, next) => {
  // TODO: 
  //  1. get emailVerificationCode from response
  //  2. store code in emailVerificationCodes (emailVerificationCodes.push(code);)

  return next();
}

exports.beforeEmailVerification = (req, context, _events, next) => {
  // TODO: 
  //  1. get first emailVerificationCode (emailVerificationCodes.pop();)
  //  2. form emailVerificationCodeLink
  //  3. set req.url = emailVerificationCodeLink

  return next();
}
