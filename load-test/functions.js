function getInteractionId(store) {
  const interactionPath = Object.keys(store).find(path =>
    path.startsWith("/interaction/")
  );

  if (interactionPath) {
    const interactionId = interactionPath.split("/interaction/")[1];
    return interactionId;
  }

  return null;
}

exports.beforeLogin = (req, context, _events, next) => {
  console.log("requestParams", req);
  console.log("context", context);
  console.log("events", _events);
  console.log("next", next);

  const store = context._jar._jar.store.idx["stage.identity.q4inc.com"];

  const interactionId = getInteractionId(store);
  console.log("Interaction Id", interactionId);

  const cookie = store[`/interaction/${interactionId}`];
  console.log("cookie", cookie);

  if (interactionId && cookie) {
    req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/login`;
    req.headers.Cookie = cookie;
  } else {
    console.error("Args not found");
  }

  return next();
};
