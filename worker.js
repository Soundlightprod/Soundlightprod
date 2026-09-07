export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact' && request.method === 'POST') {
      return handleContact(request, env);
    }

    // Tout le reste (index.html, artistes.html, images...) est servi tel quel.
    return env.ASSETS.fetch(request);
  }
};

async function handleContact(request, env) {
  try {
    const data = await request.json();

    const name = (data.name || '').trim();
    const email = (data.email || '').trim();
    const subject = (data.subject || '').trim();
    const dateEvent = (data.dateEvent || '').trim();
    const message = (data.message || '').trim();

    if (!name || !email || !message) {
      return json({ ok: false, error: 'Champs requis manquants (nom, e-mail ou message).' }, 400);
    }

    const emailSubject = `${subject || 'Nouveau message'} — ${name}`;
    const text =
`Nouvelle demande depuis le site Sound Light Prod

Nom : ${name}
E-mail : ${email}
Sujet : ${subject || '-'}
Date de l'événement : ${dateEvent || '-'}

Message :
${message}`;

    const apiKey = await env.RESEND_API_KEY.get();

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Sound Light Prod <contact@soundlightprod.fr>',
        to: ['contact@soundlightprod.fr'],
        reply_to: email,
        subject: emailSubject,
        text
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return json({ ok: false, error: `Resend: ${errText}` }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
