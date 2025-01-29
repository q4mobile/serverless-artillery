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

exports.beforeLogin = (req, context, _events, next) => {
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
  req.url = `https://stage.identity.q4inc.com/interaction/${interactionId}/login/complete`;
  req.json = {
    username: "jess.gold@q4inc.com",
    password: "iLvfcKu-ie2hntkJzvbW-jUmFv",
    isRememberUsername: false
  }

  return next();
};
