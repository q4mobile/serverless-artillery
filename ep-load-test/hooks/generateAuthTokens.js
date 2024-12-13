const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { executeSubscription } = require("./subscriptionsTest");

const attendeesPermissions = [
  "attendee:base:permission",
  "attendee:manage:attendee",
  "attendee:read:questions",
  "attendee:submit:questions",
  "attendee:view:broadcast",
  "publicToken:true"
];

const jwtPayloadBase = {
  email: "dmytro.kukharenko@q4inc.com",
  audience: "events-platform.app",
  scope: attendeesPermissions.join(" "),
  permissions: attendeesPermissions
};
const jwtOptions = {
  algorithm: "RS256",
  expiresIn: "365d",
  issuer: "events-platform-attendee",
  audience: "events-platform.app"
};

const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAq4OfL2UVkRHr+Q58pZAxKJbtxMCuUBlQwbceS3fHup3CUZHv
uOx1uEeCOu+U5TX2Q0pLZ6YgRO3KQt/SbUpOks1TRGOLhuigK2Gg75CUnNj1WkSZ
RkEsYlgRVuKa1kkS4AFzAQG4SVP8S7MPsc0CN+Jc+2lUfm3R4TsoK3w3hCXH2WUC
Bn5nwjyCaFKu5BySY9zXJi4x7DJNyf88CsIYNmmpaggmSrhF7mRiGerAfonNMZJt
tb4FfqHQ5sSoXJuhIl9pDpH/AtNmgKyZMTt6VOV3XTYKWYk5zTXIn2m9s6QYFJ0/
zx+tnJtab/UMnScbouTNgqd8Lai3Yiqoo0ymLwIDAQABAoIBAA7FSxQ91Fml/Xh5
cuqfPFyOgvOK1Hg5deb46jb9ncnIhE+aDdcTJiA0qFaDA4Op3gd1goDuoaDOCbkw
pWKcH6As5prhJ8b6ibCyu7Vl8iZ/2MFpXvnZ6wSdKQEeis8hg+qetVTE3SYTgYrT
ZOqfCS3e5LsSGyC4PHb1LURxciaDJjBO52vgZJ/l9I+gVI3NL3v3ePEhBHo3HyxG
DY476jCEvBTHp/UTi0aW8bsM4DU5czQsyt6hBBSQeGy9BAL4UFgV6KvgjVWH5GeV
a5S4L734T9ZZntOTIyh9ozR5Z2I0oIOHPEmQ15Z8puE+RBcGOXkUXpr5Dmz98ZAT
YIx+RIECgYEA5buMQFmTEhvQz13y5edldFLtpkwEvxjDfQ7Mruwdndy3WmAKrvlV
Qw4DDYosQTVCNho6OAK7PhAJhZzy+n1GJB7yGFnLZaft4bg310zMWBQ5UfnLwLBT
QkQmklJE/Dw17nm5jOU3VMAQeIoFRlzrR/uTCr+wUFd4XfRAcao2T9ECgYEAvx/5
bS8Dn6k04t3iC3nS/+VwJcHxUDUPrqZG+FUvzFZ6w3MNCSfcjfAQZbUANYed7qYh
pGYWy4iDv1mJzFqC4JnpvjW32R/gK1xr57bnw8906KtgnlXYOWl0SIe35zjV/95k
tIKfLYefJAjmpHI0LyBun2mI+pNnwGQTMKD3Ff8CgYARhuWEY1EdKJIdwAUwFR9g
aJNJBLO4AKOpft+O2OTJjnVOp9Uo1Ez0+LSy67/EmdObXRTkARFYAtE3KGpBQh1/
0/yUbwVdlBpKBkv8WReeAKz+3Bf3c3xmqdxnfW9V7yION6s4XKSECsM27xDH9X7d
1wu43jcNah78zA2+nkXWgQKBgD2diUPxzDFE04/wCFe6xpNI3IbPp4Q8FvovEOIu
VGKD3r/z71fsSeZYZnDjkVWwivHNDTt6zg5/zDl8HDiNVXQjKn/vwX12EUbpXMAu
7zjpQL9hwJxLAJJBtQNM/bTFVfhPMhgfpEGBX4S2eeS6DKjEw+UQmOBvdRtJKAad
XgrxAoGAJFD/QP4qjVZnAnxan0Ez9XD9axMU5OmCZLvdtzN3yxjausOXyd3z4khT
B4CdOMP0pMsdJbt2hyNHJCFrdN9fddR20i3pH8C2i0SDgl4X/uuT6yNkrVV5li9P
h69y3gqWReGZCFfi+GwD71PinA9V6Kqf92jvJRffu/Kh1GhrVlc=
-----END RSA PRIVATE KEY-----`;

const generateToken = async meetingId => {
  const jwtPayload = { ...jwtPayloadBase };
  jwtPayload.scope = `${jwtPayload.scope} meetingId:${meetingId}`;
  jwtPayload.permissions.push(`meetingId:${meetingId}`);
  return jwt.sign(jwtPayload, privateKey, jwtOptions);
};

const makeid = length => {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
};

const setIdToken = async (_, context, _, next) => {
  const { meetingId } = context.vars;
  context.vars.id_token = await generateToken(meetingId);
  context.vars.email = `${makeid(10)}@loading.com`;
  context.vars.wsConnectionId = uuid();
  next();
};

module.exports = {
  setIdToken,
  executeSubscription
};
