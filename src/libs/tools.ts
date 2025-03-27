import axios from 'axios'
import { config } from './utils'

interface PeerMessageResponse {
  data: any
}

interface FunctionArgs {
  filling?: string
}

type FunctionHandler = (appId: string, userId: string, channel: string, args: FunctionArgs) => Promise<string> | string

/**
 * Send a peer message using Agora RTM REST API
 * @param {string} appId - Agora app ID
 * @param {string} fromUser - Sender user ID
 * @param {string} toUser - Recipient user ID
 * @returns {Promise<PeerMessageResponse>}
 */
async function sendPeerMessage(
  appId: string,
  fromUser: string,
  toUser: string,
  payload: string,
): Promise<PeerMessageResponse> {
  const url = `https://api.agora.io/dev/v2/project/${appId}/rtm/users/${fromUser}/peer_messages`

  const data = {
    destination: String(toUser),
    enable_offline_messaging: true,
    enable_historical_messaging: true,
    payload: payload,
  }

  try {
    const response = await axios.post(url, data, {
      headers: {
        Authorization: 'Basic ' + config.agora.authToken,
        'Content-Type': 'application/json',
      },
    })
    console.log('Message sent successfully:', response.data)
    return response
  } catch (error) {
    console.error('Error sending peer message:', error)
    throw error
  }
}

/**
 * Order sandwich implementation
 * @param {string} userId - User ID
 * @param {string} channel - Channel
 * @param {string} filling - Sandwich filling
 * @returns {string} Confirmation message
 */
function orderSandwich(userId: string, channel: string, filling: string): string {
  console.log('Placing sandwich order for', userId, 'in', channel, 'with filling:', filling)
  return `Sandwich ordered with ${filling}. Enjoy!`
}

/**
 * Send photo implementation
 * @param {string} appId - Agora app ID
 * @param {string} userId - User ID
 * @param {string} channel - Channel
 * @returns {Promise<string>} Confirmation message
 */
async function sendPhoto(appId: string, userId: string, channel: string): Promise<string> {
  console.log('Sending photo to', userId, 'in', channel)

  const baseUrl = 'https://wam60lctyb.ufs.sh/f'
  const imageKeys = [
    'NW1E5hslypbTyr3pXL2RclXn8RktVdJgBrHwvPuqTQ07IaZK',
    'NW1E5hslypbTlfnx4uPvcHInBDXiCVuoxFkOeQ03bZs9g1J8',
    'NW1E5hslypbTYkNkclv7HblznpM10R5eNi7FIgK2UaEJXGsj',
    'NW1E5hslypbTps6TRQEUadZybDFIrAJWx9PVvq7Lik5s42CK',
    'NW1E5hslypbTKd7LgxLTJx0POtVY7r296oCajvpNeAkIHURE',
    'NW1E5hslypbToxjaZGD8nBTOwu9Qlxtg41JZcaSHmKRWhE6A',
    'NW1E5hslypbTfeQfhcgJX7CO6qwlaH1DP4hBcAfeT3VMoEIY',
    'NW1E5hslypbTAZfQ8kwVHtYufr7OCc1noEmRSIh5N3vLMkFK',
    'NW1E5hslypbTH3POzGldgaX05KqRFuM6Pz7QT8oBUCvm9NL1',
    'NW1E5hslypbTKsGWSQTJx0POtVY7r296oCajvpNeAkIHUREM',
    'NW1E5hslypbTcitWcAXjYIF82XSuziPgKHp3yrVwRJqvGcdD',
    'NW1E5hslypbTlsz4IxPvcHInBDXiCVuoxFkOeQ03bZs9g1J8',
    'NW1E5hslypbTcPtpRnXjYIF82XSuziPgKHp3yrVwRJqvGcdD',
    'NW1E5hslypbTdHrCp1xzBxhIYkECvTtU8Xb43SLM5f7dZacD',
    'NW1E5hslypbT1pC2GukLT4onszpWEaxCrMIVdPRmq5lf9bA3',
    'NW1E5hslypbTnetEdFd3AxIsubmQEtypwFHrVd1BGDShYUc0',
  ]
  const randomImageKey = imageKeys[Math.floor(Math.random() * imageKeys.length)]

  const payload = `{"img":"${baseUrl}/${randomImageKey}"}`

  // Call Agora's REST API to send the peer message
  await sendPeerMessage(appId, config.agentId, userId, payload)

  return `Photo sent successfully to user ${userId}.`
}

/**
 * Function map to execute functions by name
 */
const functionMap: Record<string, FunctionHandler> = {
  send_photo: (appId, userId, channel, _args) => sendPhoto(appId, userId, channel),
  order_sandwich: (appId, userId, channel, args) => orderSandwich(userId, channel, args.filling as string),
}

export { sendPeerMessage, orderSandwich, sendPhoto, functionMap }
export type { PeerMessageResponse, FunctionArgs, FunctionHandler }
