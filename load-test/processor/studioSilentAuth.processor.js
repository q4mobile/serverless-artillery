const helpers = require('./helpers/test.helpers');

exports.beforeLogin = (req, context, _events, next) => {
  const store = context._jar._jar.store.idx["stage.identity.q4inc.com"];
  const interactionId = helpers.getInteractionId(store);
  if (!interactionId) {
    console.error("Interaction id not found");
    return next();
  }
  context.vars['interactionId'] = interactionId;

  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/login/complete`;
  req.json = {
    username: "jess.gold+silent.auth.load.test@q4inc.com",
    password: helpers.getPassword(),
    isRememberUsername: false
  }

  return next();
};

exports.beforeFinishInteraction = (req, context, _events, next) => {
  const interactionId = context.vars.interactionId;
  req.url = `https://stage.identity.q4inc.com/oauth/auth/${interactionId}`;

  return next();
}

exports.afterSilentAuth = (_req, res, context, _events, next) => {
  const code = res.request.uri.query.split("&")[0].substring(5);
  context.vars['code'] = code;

  return next();
};

exports.beforeExchangeCodeForToken = (req, context, _events, next) => {
  req.form = {
    code: context.vars.code,
    grant_type: "authorization_code",
    client_id: "q4-studio-public-client",
    redirect_uri: "https://auth.stage.platform.q4inc.com/auth/v2/publicAuthRedirect",
  };

  return next();
};

exports.afterExchangeCodeForToken = (_req, res, _context, _events, next) => {
  console.log("afterExchangeCodeForToken Response", JSON.stringify(res));
  
  return next();
};