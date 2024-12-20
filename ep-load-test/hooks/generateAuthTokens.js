const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { executeSubscription } = require("./subscriptionsTest");
const { makeid } = require("./definitions");

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

const privateKey = ``;

const generateToken = async meetingId => {
  const jwtPayload = { ...jwtPayloadBase };
  jwtPayload.scope = `${jwtPayload.scope} meetingId:${meetingId}`;
  jwtPayload.permissions.push(`meetingId:${meetingId}`);
  return jwt.sign(jwtPayload, privateKey, jwtOptions);
};

const setIdToken = async (_, context, __, next) => {
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
