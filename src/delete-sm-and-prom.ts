import { Auth, gmail_v1, google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import * as path from "path";
import * as fs from "fs";

// Path to credentials file
const CREDENTIALS_PATH = path.join(__dirname, "../credentials.json");
// Path to token file
const TOKEN_PATH = path.join(__dirname, "../token.json");
// Scopes gmail api
const SCOPES = ["https://mail.google.com/"];

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<Auth.OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.promises.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content.toString());
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client: Auth.OAuth2Client) {
  const content = await fs.promises.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content.toString());
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.promises.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }

  let authClient = await authenticate({
    keyfilePath: CREDENTIALS_PATH,
    scopes: SCOPES,
  });

  if (authClient.credentials) {
    await saveCredentials(authClient);
  }
  return authClient;
}

/**
 * Lists the messages in the user's account.
 *
 * @param {Auth.BaseExternalAccountClient | Auth.OAuth2Client} auth An authorized OAuth2 client.
 */
async function listMessages(
  auth: Auth.BaseExternalAccountClient | Auth.OAuth2Client
) {
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.list({
    userId: "me",
  });
  const messages = res.data.messages!;
  if (messages.length) {
    messages.map(async (message) => {
      await gmail.users.messages.get({
        userId: "me",
        id: message.id!,
      }).then((res: any) => {
        if (
          res.data.labelIds!.includes("CATEGORY_SOCIAL") ||
          res.data.labelIds!.includes("CATEGORY_PROMOTIONS")
        ) {
          // trash the message with res.data.id
          gmail.users.messages.trash({
            userId: "me",
            id: res.data.id,
          });
        }
      });
    });
  } else {
    console.log("No messages found.");
  }
}

async function main() {
  const auth = await authorize();
  if (auth) {
    await listMessages(auth);
  }
}

main();
