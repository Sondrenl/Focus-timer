export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
    {
      domain: "https://accounts.google.com",
      applicationID:
        process.env.GOOGLE_CLIENT_ID ||
        "229654613287-8utvd3fhrcsalh1ol02ev2mlg140kbai.apps.googleusercontent.com",
    },
  ],
};
