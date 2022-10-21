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
    console.log("Messages : " + messages.length);
    messages.forEach(async (message) => {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: message.id!,
      });

      // Parse message if labels contain UNREAD and CATEGORY_PROMOTIONS
      if (
        res.data.labelIds!.includes("UNREAD") &&
        res.data.labelIds!.includes("CATEGORY_PROMOTIONS")
      ) {
        // parseMessage(res.data);
        detectNewsletter(res.data);
      }
    });
  } else {
    console.log("No messages found.");
  }
}

/**
 * Parse message
 *
 * @param {gmail_v1.Schema$Message} message
 */
function parseMessage(message: gmail_v1.Schema$Message) {
  const headers = message.payload!.headers!;
  const from = headers.find((header) => header.name === "From")?.value;
  const subject = headers.find((header) => header.name === "Subject")?.value;
  const date = headers.find((header) => header.name === "Date")?.value;

  // Get message body part from payload (mime type html)
  if (message.payload!.parts) {
    const bodyPart = message.payload!.parts.find(
      (part) => part.mimeType === "text/html"
    );
    if (bodyPart) {
      const body = Buffer.from(bodyPart.body!.data!, "base64").toString("utf8");

      // console.log(`From: ${from}`);
      // console.log(`Subject: ${subject}`);
      // console.log(`Date: ${date}`);
      // console.log(`Body: ${body}`);

      const dataFolderPath = path.join(__dirname, "../data");

      // Create data folder if not exist
      if (!fs.existsSync(dataFolderPath)) {
        fs.mkdirSync(dataFolderPath);
      }

      // If subject contains japanese characters, skip
      if (
        !subject?.match(
          /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
        )
      )
        fs.writeFileSync(path.join(dataFolderPath, `${subject}.html`), body, {
          encoding: "utf-8",
        });
    }
  }
}

/**
 * Detect newsletter
 * @param {gmail_v1.Schema$Message} message
 */
function detectNewsletter(message: gmail_v1.Schema$Message) {
  const headers = message.payload!.headers!;
  const from = headers.find((header) => header.name === "From")?.value;
  const subject = headers.find((header) => header.name === "Subject")?.value;
  const date = headers.find((header) => header.name === "Date")?.value;

  // Get message body part from payload (mime type html)
  if (message.payload!.parts) {
    const bodyPart = message.payload!.parts.find(
      (part) => part.mimeType === "text/html"
    );
    if (bodyPart) {
      const body = Buffer.from(bodyPart.body!.data!, "base64").toString("utf8");

      // Detect newsletter from header List-Unsubscribe
      const listUnsubscribe = headers.find(
        (header) => header.name === "List-Unsubscribe"
      )?.value;

      // Method 1: Detect newsletter from header List-Unsubscribe
      if (listUnsubscribe) {
        console.log("-------------------------------------");
        console.log(`From: ${from}`);
        console.log(`Subject: ${subject}`);
        console.log(`Date: ${date}`);
        console.log(`List-Unsubscribe: ${listUnsubscribe}`);

        // Find url to unsubscribe
        const unsubscribeUrl =
          listUnsubscribe.match(/<(https?:\/\/[^>]+)>/im)?.[1];
        if (unsubscribeUrl) {
          console.log(`Unsubscribe url: ${unsubscribeUrl}`);
        } else {
          // Find mailto to unsubscribe
          const unsubscribeMailto =
            listUnsubscribe.match(/<mailto:([^>]+)>/im)?.[1];
          if (unsubscribeMailto) {
            console.log(`Unsubscribe mailto: ${unsubscribeMailto}`);
          }
        }
        console.log("-------------------------------------");
        return;
      }

      // Method 2: Detect newsletter from body with regex
      const sanitizedBody = body.replace(/\s/g, "");

      const links = sanitizedBody.match(
        /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/gi
      );
      // If we find links, iterate over them
      if (links) {
        links.forEach((link) => {
          const url = link.match(
            /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/i
          )?.[1];
          const text = link.match(
            /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/i
          )?.[2];

          // If we find unsubscribe in text or link, log it
          if (
            url?.toLowerCase().match(/unsubscribe|optout|opt\-out|remove/i) ||
            text?.toLowerCase().match(/unsubscribe|optout|opt\-out|remove/i)
          ) {
            console.log("-------------------------------------");
            console.log(`From: ${from}`);
            console.log(`Subject: ${subject}`);
            console.log(`Date: ${date}`);
            console.log(`Unsubscribe url (body): ${url}`);
            console.log("-------------------------------------");
          }
        });
        return;
      }

      // Method 3: Use GPT-3 to detect newsletter
      // 
    }
  }
}

async function main() {
  const auth = await authorize();
  if (auth) {
    await listMessages(auth);
  }
}

main();
