(() => {
  const state = {
    trips: [],
    trip: null,
    variant: null,
    method: 'pix',
    quantity: 1,
    checkoutRequestId: null,
    pollSeq: 0
  };
  const $ = (id) => document.getElementById(id);
  const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
  const dateBR = (iso) => iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`)) : '';

  function newRequestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function resetCheckoutAttempt() {
    state.checkoutRequestId = null;
    state.pollSeq += 1;
    $('pixCard')?.classList.add('hidden');
  }

  function selectedPrice(method = state.method) {
    if (!state.variant) return 0;
    return Number(method === 'card' ? state.variant.cardPrice : state.variant.pixPrice) * state.quantity;
  }

  function updateSummary() {
    $('summaryTitle').textContent = state.trip?.title || 'Selecione seu passeio';
    $('summaryMeta').textContent = state.trip ? `${dateBR(state.trip.date)} • ${state.trip.location}` : 'As informações aparecerão aqui.';
    $('summaryVariant').textContent = state.variant?.name || '—';
    $('summaryQty').textContent = String(state.quantity);
    $('summaryMethod').textContent = state.method === 'card' ? 'Cartão' : 'PIX';
    $('summaryTotal').textContent = state.variant ? money(selectedPrice()) : 'R$ —';
    $('buttonTotal').textContent = state.variant ? money(selectedPrice()) : 'R$ —';
    $('pixPrice').textContent = state.variant ? money(Number(state.variant.pixPrice) * state.quantity) : '—';
    $('cardPrice').textContent = state.variant ? money(Number(state.variant.cardPrice) * state.quantity) : '—';
  }

  async function loadTrips() {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('Falha ao carregar passeios');
      const data = await response.json();
      state.trips = data.trips || [];
      $('trip').innerHTML = '<option value="">Selecione um passeio</option>' + state.trips.map(t => `<option value="${t.id}">${t.title} • ${dateBR(t.date)}</option>`).join('');
    } catch {
      $('trip').innerHTML = '<option value="">Não foi possível carregar os passeios</option>';
      $('formMessage').textContent = 'Não foi possível carregar os passeios. Atualize a página.';
    }
  }

  $('trip').addEventListener('change', (e) => {
    resetCheckoutAttempt();
    state.trip = state.trips.find(t => t.id === e.target.value) || null;
    state.variant = null;
    if (!state.trip) {
      $('variant').disabled = true;
      $('variant').innerHTML = '<option value="">Selecione o passeio primeiro</option>';
    } else {
      $('variant').disabled = false;
      $('variant').innerHTML = '<option value="">Selecione uma opção</option>' + state.trip.variants.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
    }
    updateSummary();
  });

  $('variant').addEventListener('change', (e) => {
    resetCheckoutAttempt();
    state.variant = state.trip?.variants.find(v => v.id === e.target.value) || null;
    updateSummary();
  });

  $('quantity').addEventListener('change', (e) => {
    resetCheckoutAttempt();
    state.quantity = Number(e.target.value || 1);
    updateSummary();
  });

  document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      resetCheckoutAttempt();
      state.method = radio.value;
      document.querySelectorAll('.pay-card').forEach(c => c.classList.toggle('active', c.dataset.method === state.method));
      updateSummary();
    });
  });

  function maskCpf(value) {
    return value.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function maskPhone(value) {
    const d = value.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  }

  $('cpf').addEventListener('input', (e) => { resetCheckoutAttempt(); e.target.value = maskCpf(e.target.value); });
  $('phone').addEventListener('input', (e) => { resetCheckoutAttempt(); e.target.value = maskPhone(e.target.value); });
  ['name', 'email'].forEach((id) => $(id).addEventListener('input', resetCheckoutAttempt));

  async function copyPixCode() {
    const code = $('pixCode').value;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      $('pixCode').focus();
      $('pixCode').select();
      document.execCommand('copy');
    }
    $('pixCopyMessage').textContent = '✓ Código PIX copiado. Abra o app do seu banco e cole no PIX Copia e Cola.';
    $('copyPixBtn').querySelector('span').textContent = 'Código copiado!';
    setTimeout(() => {
      $('copyPixBtn').querySelector('span').textContent = 'Copiar código PIX';
    }, 2500);
  }

  $('copyPixBtn').addEventListener('click', copyPixCode);

  function renderReservation(r) {
    const approved = r.status === 'approved';
    const pending = r.status === 'pending';
    $('statusIcon').textContent = approved ? '✅' : pending ? '⏳' : '⚠️';
    $('returnTitle').textContent = approved ? 'Pagamento aprovado. Reserva confirmada!' : pending ? 'Pagamento em processamento' : 'Pagamento não confirmado';
    $('returnText').textContent = approved ? 'Tudo certo. O sistema já registrou seu pagamento automaticamente.' : pending ? 'O Mercado Pago ainda não confirmou o pagamento. Esta tela será atualizada automaticamente.' : 'O pagamento não foi aprovado. Você pode iniciar uma nova tentativa de pagamento.';
    $('returnDetails').innerHTML = `<span>${r.id}</span><span>${r.tripTitle}</span><span>${r.customerName}</span><span>${money(r.amount)}</span>`;
    return approved;
  }

  async function pollReservation(reservationId, seq) {
    for (let i = 0; i < 100 && seq === state.pollSeq; i++) {
      try {
        const response = await fetch(`/api/payment-status?reservation=${encodeURIComponent(reservationId)}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.ok && data.reservation) {
          if (data.reservation.status === 'approved') {
            $('pixStatusText').textContent = 'Pagamento aprovado! Reserva confirmada.';
            $('pixStatusText').classList.add('approved-text');
            $('returnCard').classList.remove('hidden');
            renderReservation(data.reservation);
            $('returnCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
          if (['rejected', 'cancelled', 'refunded'].includes(data.reservation.status)) {
            $('pixStatusText').textContent = 'Pagamento não confirmado. Gere uma nova tentativa.';
            return;
          }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  function showPix(data) {
    if (data.status === 'approved') {
      $('returnCard').classList.remove('hidden');
      $('statusIcon').textContent = '✅';
      $('returnTitle').textContent = 'Pagamento aprovado. Reserva confirmada!';
      $('returnText').textContent = 'Tudo certo. O pagamento já está confirmado.';
      $('returnDetails').innerHTML = `<span>${data.reservationId}</span><span>${money(data.amount)}</span>`;
      $('returnCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const pix = data.pix || {};
    $('pixAmount').textContent = money(data.amount);
    $('pixCode').value = pix.qrCode || '';
    $('pixReservationText').textContent = `Reserva ${data.reservationId} • confirmação automática`;
    $('pixCopyMessage').textContent = '';
    $('pixStatusText').textContent = 'Aguardando pagamento...';
    $('pixStatusText').classList.remove('approved-text');

    if (pix.qrCodeBase64) {
      $('pixQrImage').src = `data:image/png;base64,${pix.qrCodeBase64}`;
      $('pixQrImage').closest('.pix-qr-wrap').classList.remove('hidden');
    } else {
      $('pixQrImage').removeAttribute('src');
      $('pixQrImage').closest('.pix-qr-wrap').classList.add('hidden');
    }

    if (pix.ticketUrl) {
      $('pixTicketLink').href = pix.ticketUrl;
      $('pixTicketLink').classList.remove('hidden');
    } else {
      $('pixTicketLink').classList.add('hidden');
    }

    $('pixCard').classList.remove('hidden');
    $('pixCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const seq = ++state.pollSeq;
    pollReservation(data.reservationId, seq);
  }

  $('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formMessage').textContent = '';
    if (!state.trip || !state.variant) return $('formMessage').textContent = 'Selecione o passeio e a opção.';

    if (!state.checkoutRequestId) state.checkoutRequestId = newRequestId();

    const button = $('payButton');
    button.disabled = true;
    button.querySelector('span').textContent = state.method === 'pix' ? 'Gerando PIX seguro...' : 'Criando pagamento seguro...';

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: state.checkoutRequestId,
          tripId: state.trip.id,
          variantId: state.variant.id,
          quantity: state.quantity,
          paymentMethod: state.method,
          customer: { name: $('name').value, cpf: $('cpf').value, phone: $('phone').value, email: $('email').value }
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível iniciar o pagamento.');

      if (data.paymentMode === 'pix_direct') {
        showPix(data);
        button.disabled = false;
        button.querySelector('span').textContent = 'Mostrar PIX novamente';
        return;
      }

      if (!data.checkoutUrl) throw new Error('O Mercado Pago não retornou o checkout do cartão.');
      window.location.href = data.checkoutUrl;
    } catch (error) {
      $('formMessage').textContent = error.message;
      button.disabled = false;
      button.querySelector('span').textContent = 'Continuar para pagamento';
    }
  });

  async function checkReturn() {
    const params = new URLSearchParams(location.search);
    const reservation = params.get('reserva') || params.get('external_reference');
    if (!reservation) return;
    $('returnCard').classList.remove('hidden');
    $('returnCard').scrollIntoView({ behavior: 'smooth', block: 'center' });

    for (let i = 0; i < 8; i++) {
      try {
        const response = await fetch(`/api/payment-status?reservation=${encodeURIComponent(reservation)}`, { cache: 'no-store' });
        const data = await response.json();
        if (response.ok && data.reservation && renderReservation(data.reservation)) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 3500));
    }
  }

  loadTrips();
  updateSummary();
  checkReturn();
})();
