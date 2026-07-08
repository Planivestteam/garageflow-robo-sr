/**
 * Normaliza um numero de telefone portugues para o formato
 * internacional exigido pelo link wa.me (so digitos, com indicativo
 * do pais). Aceita numeros com ou sem +351, com espacos, tracos, etc.
 */
export function normalizePhoneForWhatsApp(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/[^\d]/g, '');
  if (!digits) return null;

  if (digits.startsWith('351') && digits.length >= 12) return digits;
  if (digits.length === 9) return `351${digits}`; // numero nacional sem indicativo
  if (digits.startsWith('00351')) return digits.slice(2);
  return digits; // ja parece ter indicativo de outro pais, ou formato invulgar
}

/**
 * Mensagem curta e casual para WhatsApp (tom diferente do email --
 * mais direto e breve, como e habito neste canal).
 */
export function buildWhatsAppMessage(workshopName, bookingLink) {
  return `Olá! Falo em nome da GarageFlow -- ajudamos oficinas como a ${workshopName} a organizar clientes, viaturas e faturação num único sítio, sem complicações.

Faz sentido mostrar-lhe em 5 minutos como funciona? Pode ser aqui: ${bookingLink}`;
}

/**
 * Constroi o link wa.me pronto a abrir, com o numero normalizado e a
 * mensagem ja preenchida (o utilizador so precisa de rever e enviar).
 */
export function buildWhatsAppLink(phone, message) {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
