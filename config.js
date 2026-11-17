// Supabase project settings. The publishable key is meant to be public; safety comes from the RLS rules in schema.sql.
// Never put an "sb_secret_" key or the service_role key in this file.
window.CH_CONFIG = {
  url: 'https://uiuwwjrfelzpddgdljcp.supabase.co',
  key: 'sb_publishable_nrKi6lP7ZR4FMjLbgbWGJA_naYc5qAR',
  // Length of the e-mail confirmation code. Must match Supabase > Authentication > Sign In / Providers > Email > Email OTP Length (6 to 10).
  otpLen: 8,
  // Cloudflare Turnstile SITE key (public). Leave empty until CAPTCHA is turned on in Supabase, then paste it here.
  // Shown on the privacy / terms pages so people can reach you (and ask to delete data). Leave empty to hide it.
  contactEmail: '',
  // Vodafone Cash wallet number that receives subscription payments (public on purpose: users must see it to pay). Example: '01012345678'.
  vodafoneCash: '',
  // Web Push public key (VAPID). Generate a pair with `npx web-push generate-vapid-keys`; the PRIVATE key goes only in the Edge Function secrets. Empty = hide the notifications switch.
  vapidPublicKey: 'BMZN_8UXkqwW6uixNPcx42EkZRME8qoV5RFm3ML0r0Grkjlluq00z3ISAoPt7wWjyZG6JyveIXfDkyevsu6auL4',
  // Optional: run the AI helper on your own server (server/ai-server.mjs or server/ai_server.py) instead of the Supabase Edge Function. Example: 'https://ai.example.com/ai'. Leave empty to use the Edge Function. If you set it, also add the address to connect-src in public/_headers.
  aiUrl: '',
  captchaSiteKey: '0x4AAAAAAFnvGJ6b7pIL7Xrb'
};
