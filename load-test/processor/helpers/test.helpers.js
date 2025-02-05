exports.getRandomString = () => "rbtxv2k9wd9"  // change value between load test runs

exports.getInteractionId = (store) => {
  const interactionPath = Object.keys(store).find(path =>
    path.startsWith("/interaction/")
  );

  if (!interactionPath) return null;

  const interactionId = interactionPath.split("/interaction/")[1];
  return interactionId;
}

exports.getCookies = (store, interactionId) => {
  const cookieObj = store[`/interaction/${interactionId}`];
  return Object.keys(cookieObj)
    .map(key => {
      const match = `${cookieObj[key]}`.match(/=(.*?);/);
      return match ? `${key}=${match[1].trim()}` : "";
    })
    .join("; ");
}

exports.getEmail = (randomString, userCount) => {
  const email = `jess.gold+loadtest.${randomString}.${userCount}@q4inc.com`;
  return email
}

exports.getPassword = () => {
  return "!q4Inc1234"
}
