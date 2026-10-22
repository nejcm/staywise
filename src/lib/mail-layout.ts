const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type BrandedMail = {
  preheader: string;
  heading: string;
  body: string;
  action?: { label: string; url: string };
  footnote: string;
};

// Table layout with inline styles only: mail clients strip <style>, and no remote images keeps it
// out of image-blocking and spam heuristics. Always sent alongside the plain-text twin.
export function renderBrandedMail(mail: BrandedMail): { html: string; text: string } {
  const button = mail.action
    ? `<tr><td style="padding:8px 0 24px"><a href="${escapeHtml(mail.action.url)}" style="display:inline-block;background:#0f5e63;color:#ffffff;font-weight:600;font-size:16px;line-height:1;text-decoration:none;padding:14px 24px;border-radius:8px">${escapeHtml(mail.action.label)}</a></td></tr>`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(mail.heading)}</title></head>
<body style="margin:0;padding:0;background:#f2f5f4">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(mail.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f4"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2423">
<tr><td style="background:#0f5e63;border-radius:12px 12px 0 0;padding:20px 32px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.2px">staywise</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:22px;line-height:1.3;font-weight:700;padding-bottom:12px">${escapeHtml(mail.heading)}</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding-bottom:16px">${escapeHtml(mail.body)}</td></tr>
${button}
<tr><td style="font-size:13px;line-height:1.5;color:#5b6664;border-top:1px solid #e3e8e7;padding-top:16px">${escapeHtml(mail.footnote)}</td></tr>
</table></td></tr>
<tr><td style="padding:16px 32px;font-size:12px;line-height:1.5;color:#7a8583;text-align:center">Staywise, the guest portal for vacation-rental hosts.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    mail.heading,
    '',
    mail.body,
    ...(mail.action ? ['', `${mail.action.label}: ${mail.action.url}`] : []),
    '',
    mail.footnote,
    '',
    '-- Staywise',
  ].join('\n');
  return { html, text };
}
