const jwt = require('jsonwebtoken')
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')

const attendeesPermissions = [
    'attendee:base:permission',
    'attendee:manage:attendee',
    'attendee:read:questions',
    'attendee:submit:questions',
    'attendee:view:broadcast',
    'publicToken:true',
]

const jwtPayloadBase = {
    email: 'dmytro.kukharenko@q4inc.com',
    audience: 'events-platform.app',
    scope: attendeesPermissions.join(' '),
    permissions: attendeesPermissions,
}
const jwtOptions = {
    algorithm: 'RS256',
    expiresIn: '365d',
    issuer: 'events-platform-attendee',
    audience: 'events-platform.app',
}
const ssmPrivateKeyParameterName = '/dev/events-platform-api/EP_ATTENDEE_API_AUTH_PRIVATE_KEY'
let privateKey = null

const getSecureParameter = async (parameterName) => {
    const client = new SSMClient()

    try {
        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true, // decrypts the SecureString parameter
        })

        const response = await client.send(command)

        return response.Parameter.Value
    } catch (error) {
        console.error(`Error retrieving parameter: ${error}`)
        return null
    }
}

const getPrivateKey = async () => {
    if (!privateKey) {
        privateKey = await getSecureParameter(ssmPrivateKeyParameterName)
    }
    return privateKey
}

const generateToken = async (meetingId) => {
    const jwtPayload = { ...jwtPayloadBase }
    jwtPayload.scope = `${jwtPayload.scope} meetingId:${meetingId}`
    jwtPayload.permissions.push(`meetingId:${meetingId}`)
    return jwt.sign(jwtPayload, await getPrivateKey(), jwtOptions)
}

const makeid = (length) => {
    let result = ''
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const charactersLength = characters.length
    let counter = 0
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength))
        counter += 1
    }
    return result
}

const setIdToken = async (requestParams, context, _, next) => {
    const { meetingId } = context.vars
    context.vars.id_token = await generateToken(meetingId)
    context.vars.email = `${makeid(10)}@loading.com`
    next()
}

const connectWSHandler = async (context) => {
    const { meetingId, companyId } = context.vars
    context.vars.access_token = await generateToken(meetingId)
    context.vars.target = `wss://attendees.dev.events.q4inc.com/graphql?x-meeting-id=${meetingId}&x-company-id=${companyId}&ep-wss=true`
    context.ws.token = `Bearer ${context.vars.access_token}`
}

const startScenarioTime = new Date()
// const endTime = new Date(startScenarioTime.getTime() + 1000 * 60 * 5) // 5 mins
const endTime = new Date(startScenarioTime.getTime() + 1000 * 11) // 11 seconds

const calculateSubscriptionTime = (context) => {
    const currentTime = new Date()
    const timeToEnd = (endTime - currentTime) / 1000
    console.log('timeToEnd', timeToEnd)
    context.vars.end_sub_time = timeToEnd
}

module.exports = {
    setIdToken, calculateSubscriptionTime, connectWSHandler,
}
