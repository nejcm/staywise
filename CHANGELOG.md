## [1.3.2](https://github.com/nejcm/staywise/compare/v1.3.1...v1.3.2) (2026-10-23)

### Bug Fixes

* **host:** block navigation on stale reloads so invalidate lands before navigating ([d889d1a](https://github.com/nejcm/staywise/commit/d889d1a8dc9978004065f9b862e87edafdbb4bb4))

## [1.3.1](https://github.com/nejcm/staywise/compare/v1.3.0...v1.3.1) (2026-10-23)

### Bug Fixes

* **host:** refresh the property list after create, copy and delete ([897cabc](https://github.com/nejcm/staywise/commit/897cabcb2fe78562bf787dfbaad157c59d53d6e0))

### Performance Improvements

* **host:** trim Auth and DB round trips on host pages ([aa784a2](https://github.com/nejcm/staywise/commit/aa784a2c9de6c89bc50564923b2636c40007d594))

## [1.3.0](https://github.com/nejcm/staywise/compare/v1.2.0...v1.3.0) (2026-10-23)

### Features

* **auth:** invite email, hosted Auth config and URL docs ([ddf70ae](https://github.com/nejcm/staywise/commit/ddf70ae2f0338bf5cc017201fc205a7e35eec074))
* **host:** open the add-property form in a dialog ([#27](https://github.com/nejcm/staywise/issues/27)) ([9973b5c](https://github.com/nejcm/staywise/commit/9973b5cba59f7e41a6fad073bb33aabdb4e1b276))
* **logging:** log error class and code on server errors ([6f7579c](https://github.com/nejcm/staywise/commit/6f7579c04cf20beff48a90196dd5301820d85faa))
* **ui:** add sign out button to host sidebar ([d69325c](https://github.com/nejcm/staywise/commit/d69325ca5c65f4ba23480e3962e8326ab0d69940))

### Bug Fixes

* **ci:** give the e2e job 20 minutes for slow apt installs ([d336e89](https://github.com/nejcm/staywise/commit/d336e89673b4a166125513b85ba463a7c2970922))
* **deploy:** omit APP_ORIGIN from Netlify secrets scan ([e0f46a0](https://github.com/nejcm/staywise/commit/e0f46a0a775bb5bc8bb211d1a302a80be06fa9bf))

### Performance Improvements

* **host:** cut host page loads to one server call ([#26](https://github.com/nejcm/staywise/issues/26)) ([203d156](https://github.com/nejcm/staywise/commit/203d1565523d39d206d85fe531829af081317217))

## [1.2.0](https://github.com/nejcm/staywise/compare/v1.1.0...v1.2.0) (2026-10-22)

### Features

* keep server errors in PostHog and email host support requests ([#25](https://github.com/nejcm/staywise/issues/25)) ([bc4aec6](https://github.com/nejcm/staywise/commit/bc4aec6895e080c46810a138620b66d176cfe188))

## [1.1.0](https://github.com/nejcm/staywise/compare/v1.0.0...v1.1.0) (2026-10-22)

### Features

* **ui:** show the large white logo in the hero panel on sign-in and not-found ([#24](https://github.com/nejcm/staywise/issues/24)) ([5d3224a](https://github.com/nejcm/staywise/commit/5d3224ac82547f529bfcfff99e76a32e07e925f7))

## 1.0.0 (2026-10-22)

### Features

* add host guide authoring, private notes and guest preview ([a313a14](https://github.com/nejcm/staywise/commit/a313a1410e08f2d2b97526eac154f9b761733272))
* add invite-only host auth and tenant-isolated database access ([881728b](https://github.com/nejcm/staywise/commit/881728bb8dc91e749ae96d807e96a5d2a4f788fb))
* add revocable guest links and mobile guest guide ([9b92cd0](https://github.com/nejcm/staywise/commit/9b92cd03b593363d0d92806773dda8110b88a59a))
* **agent:** MCP agent access, OAuth for AI clients, security activity ([#20](https://github.com/nejcm/staywise/issues/20)) ([8876690](https://github.com/nejcm/staywise/commit/8876690c47d997a8c92588e2646b748f432a41ae))
* **auth:** per-host opt-in 2FA; forward client IP to Supabase Auth on magic-link send ([2b11403](https://github.com/nejcm/staywise/commit/2b114037bea31bba39f813eccfd99ea906f1f461))
* **db:** fill out Bled property in the dev seed and document it ([cc9206f](https://github.com/nejcm/staywise/commit/cc9206fefa42b413d7665d86b7e18eb7c6feca9d))
* **guest:** add French and Spanish guest languages ([#9](https://github.com/nejcm/staywise/issues/9)) ([45b9f20](https://github.com/nejcm/staywise/commit/45b9f205498b388030238017632ac6ad4e1395bb))
* **guest:** add per-property guest page themes ([#10](https://github.com/nejcm/staywise/issues/10)) ([1f3bda1](https://github.com/nejcm/staywise/commit/1f3bda187be3bd8395a3313ea1a6cafcfdb00a6f))
* **guest:** guide sections as details, language sheet, localized unavailable page ([39b9edd](https://github.com/nejcm/staywise/commit/39b9edde34e027ea5e443cb69c47cd7eb62928ac))
* **guest:** help form error summary, sending, recap and send-another states ([5de3ecd](https://github.com/nejcm/staywise/commit/5de3ecd7b7619917112788ba68d8cdc07444b317))
* **guest:** home, guide, section, help and unavailable pages follow the guest boards ([b49ecb4](https://github.com/nejcm/staywise/commit/b49ecb4aa0f71c1bbf00dc2a06f455ca97e18544))
* **guest:** privacy panel on help; retention cron always scheduled ([b2e9e8a](https://github.com/nejcm/staywise/commit/b2e9e8a4b101102fd34addf9abf73cd07e584c4d))
* **guest:** remember language choice in sw_lang cookie ([54c8772](https://github.com/nejcm/staywise/commit/54c8772da6cb07dd57a10fd75870ff514cd40f14))
* **guest:** reviewed-translation banner and retryable error page ([4a8a5b2](https://github.com/nejcm/staywise/commit/4a8a5b2c4156efd3f9127123bdb30356ea62641f))
* **guest:** show essentials with copy after link exchange ([d90e706](https://github.com/nejcm/staywise/commit/d90e7061c99b79ee9fc06849190911ed997f7ba7))
* **guest:** text-first opening skeleton with slow-link retry ([abd4927](https://github.com/nejcm/staywise/commit/abd4927c47ff59f2a5d9d2e8432cc6a1c3cbcef9))
* **guest:** Wi-Fi QR code behind a toggle on the arrival card ([acb7215](https://github.com/nejcm/staywise/commit/acb7215bbde2a67a3af7acff581a29c38c5bbbc5))
* hero photo per property, served only to owners and live guest links, plus lucide icons ([#17](https://github.com/nejcm/staywise/issues/17)) ([934f6c0](https://github.com/nejcm/staywise/commit/934f6c0053a76e81c96800ab1388aad975dc5be4))
* **home:** move logo into the hero panel as a large white mark ([430d9fe](https://github.com/nejcm/staywise/commit/430d9fefe43f0bf5307786fccae920dd35655fc8))
* host contact phone, answering hours and call actions ([475214a](https://github.com/nejcm/staywise/commit/475214a1266ea765becee1dc47f6d3af67b96401))
* **host:** add account deletion to settings ([#14](https://github.com/nejcm/staywise/issues/14)) ([650ba0b](https://github.com/nejcm/staywise/commit/650ba0bc277ade7366cd0b894318dae1328a1429))
* **host:** add account settings with defaults for new properties ([#11](https://github.com/nejcm/staywise/issues/11)) ([6527ae2](https://github.com/nejcm/staywise/commit/6527ae25cf44a22bb255fe453741affd60401f32))
* **host:** category icons and compact controls in the guest preview ([47b08eb](https://github.com/nejcm/staywise/commit/47b08ebc1eded60c03a8703753de3d373fcae8ff))
* **host:** device frames for the guest preview and centered badge text ([67023ed](https://github.com/nejcm/staywise/commit/67023ed085918152e26db9d04247636b39febeeb))
* **host:** editor, sign-in and privacy pages follow the Lake boards ([7a46741](https://github.com/nejcm/staywise/commit/7a467412626cba70b37dc8ce2ae4d42609755152))
* **host:** essentials schema and editor fields ([6b85536](https://github.com/nejcm/staywise/commit/6b8553632cf4c42b76d68ade8970680d1d1891bd))
* **host:** group the property editor into Property, Guide, Share and Inbox tabs ([#18](https://github.com/nejcm/staywise/issues/18)) ([b797c57](https://github.com/nejcm/staywise/commit/b797c57587a8ce75e1cc9717ddc1e6773acc2410))
* **host:** Host guide page and inline tips in the property editor ([eb436dd](https://github.com/nejcm/staywise/commit/eb436dd170a28a1b524f94515defa56a76540df3))
* **host:** restyle workspace dashboard to the Lake workspace board ([51b9ba6](https://github.com/nejcm/staywise/commit/51b9ba6a6b6376d51f97062c2c6d841ecf7f90d5))
* **mail:** brand host emails with a shared layout ([d0dac2c](https://github.com/nejcm/staywise/commit/d0dac2c99b5a7b22e663d09df9ca842a21ab81c1))
* per-stay guest links, QR card download/print, guide gaps and readiness ([#16](https://github.com/nejcm/staywise/issues/16)) ([a33a071](https://github.com/nejcm/staywise/commit/a33a0719057ab1c79ad9444d84bfd9e1f1e447c4))
* property address with maps link, editable timezone, host avatar ([02daca2](https://github.com/nejcm/staywise/commit/02daca29bb140bce4c3e9de517251232782f50d6))
* remove a property completely and state what the local app stores ([175d446](https://github.com/nejcm/staywise/commit/175d446d5ca3651659525d9fb9bf4561e7570ccf))
* root not-found page ([778122d](https://github.com/nejcm/staywise/commit/778122d2be0dd52d83c3ba44cbb27ac846e30f88))
* styled not-found page on the public layout ([94cac6f](https://github.com/nejcm/staywise/commit/94cac6fa9f64bc606ac890bf41e08aef61c2a5b8))
* test seed, optional 2fa ([70733fe](https://github.com/nejcm/staywise/commit/70733fe0039e797cd1e0165d34d4d03bd10415e9))
* **ui:** add sm control size, normal-weight field text ([fda6586](https://github.com/nejcm/staywise/commit/fda6586d70fdf101bfaf1d853aa34ba1a45cbed3))
* **ui:** adopt Lake design tokens and self-host DM Sans ([ba93edf](https://github.com/nejcm/staywise/commit/ba93edfa8c3b1f7c7441a26c5e96630703cf020b))
* **ui:** animate dialog, toast, sent recap, and language menu ([#8](https://github.com/nejcm/staywise/issues/8)) ([675a075](https://github.com/nejcm/staywise/commit/675a07544b1b0db36d7edc07efd815b6b39ec9c8))
* **ui:** responsive guest layout up to 800px ([82e145e](https://github.com/nejcm/staywise/commit/82e145e6ed308685d2b01b6ef3236d539f7a2029))
* **ui:** restyle guest screens to Lake boards ([dde80e6](https://github.com/nejcm/staywise/commit/dde80e64de3cc1fc1b103be9224df74830030289))
* **ui:** restyle host screens to Lake boards ([da8e35e](https://github.com/nejcm/staywise/commit/da8e35ef7ac0db61bd30340e8385dcd113be8e0a))
* **ui:** roofline S logo, favicon and touch icon ([#19](https://github.com/nejcm/staywise/issues/19)) ([d95e15a](https://github.com/nejcm/staywise/commit/d95e15a0af02ea9adfab72cdb86a9361bcd5454f))
* **ui:** shared Button, Field, Pill, Toast and ConfirmDialog components ([957217c](https://github.com/nejcm/staywise/commit/957217cf1d4a2561026da021f8d0a7f510fc1acb))
* **ui:** tighten controls, restyle checkboxes, redirect signed-in home ([#13](https://github.com/nejcm/staywise/issues/13)) ([2d23a90](https://github.com/nejcm/staywise/commit/2d23a90589be3fea039d245ba576cfe346ae4a4e)), closes [#12](https://github.com/nejcm/staywise/issues/12)

### Bug Fixes

* **editor:** keep unsaved guest-language ticks; record alert decision ([14dc5c0](https://github.com/nejcm/staywise/commit/14dc5c05778c050a1c5c6c4efad9ccd107865a6e))
* **guest:** keep section headings outside summary for heading navigation ([6c40d47](https://github.com/nejcm/staywise/commit/6c40d479ce896dc4c992d02f5d3b58c589e53d49))
* **guest:** visual review — callout button contrast, guide summary layout, recap stacking, reply email required ([2d3b42c](https://github.com/nejcm/staywise/commit/2d3b42c9af930d867f6df7b7a862b7e242d4aa9e))
* **host:** show an error when removing the authenticator fails ([79b0363](https://github.com/nejcm/staywise/commit/79b03639b43b7bcda721658914f4af4ddd6c6e60))
* ISO link date, sign-in heading first on mobile, re-exchange on hash change ([92536a6](https://github.com/nejcm/staywise/commit/92536a602a45041d6aa660260cc3223218488d09))
* no stretched hero on mobile sign-in ([a88001e](https://github.com/nejcm/staywise/commit/a88001e6c08892b46fd2333b16a09a80ec0df1cc))
* **security:** audit hardening for agent guard, OAuth, MFA enrollment and guest policies ([#21](https://github.com/nejcm/staywise/issues/21)) ([9f1312e](https://github.com/nejcm/staywise/commit/9f1312ea07c38854cfe5fccd6468f9c3624f85a4))
* show Staywise name in home header ([a62cfc0](https://github.com/nejcm/staywise/commit/a62cfc043740e752b329c059d507ce3dfdb2ce2d))
