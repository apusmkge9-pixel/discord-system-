const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const express = require("express");
const app = express();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("My Bot Hosting is running!");
});

app.get("/health", (req, res) => {
  res.json({
    website: "online",
    bot: client.isReady() ? "online" : "offline"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Web server running on port " + PORT);
});

client.once("ready", () => {
  console.log("Bot online: " + client.user.tag);
});

client.on("error", console.error);

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

