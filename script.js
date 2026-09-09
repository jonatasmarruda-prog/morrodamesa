(() => {
  const state = { trips: [], trip: null, variant: null, method: 'pix', quantity: 1, checkoutRequestId: null };
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

  $('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formMessage').textContent = '';
    if (!state.trip || !state.variant) return $('formMessage').textContent = 'Selecione o passeio e a opção.';

    if (!state.checkoutRequestId) state.checkoutRequestId = newRequestId();

    const button = $('payButton');
    button.disabled = true;
    button.querySelector('span').textContent = 'Criando pagamento seguro...';

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
      window.location.href = data.checkoutUrl;
    } catch (error) {
      $('formMessage').textContent = error.message;
      button.disabled = false;
      button.querySelector('span').textContent = 'Continuar para pagamento';
    }
  });

  function renderReservation(r) {
    const approved = r.status === 'approved';
    const pending = r.status === 'pending';
    $('statusIcon').textContent = approved ? '✅' : pending ? '⏳' : '⚠️';
    $('returnTitle').textContent = approved ? 'Pagamento aprovado. Reserva confirmada!' : pending ? 'Pagamento em processamento' : 'Pagamento não confirmado';
    $('returnText').textContent = approved ? 'Tudo certo. O sistema já registrou seu pagamento automaticamente.' : pending ? 'O Mercado Pago ainda não confirmou o pagamento. Esta tela será atualizada automaticamente.' : 'O pagamento não foi aprovado. Você pode iniciar uma nova tentativa de pagamento.';
    $('returnDetails').innerHTML = `<span>${r.id}</span><span>${r.tripTitle}</span><span>${r.customerName}</span><span>${money(r.amount)}</span>`;
    return approved;
  }

  async function checkReturn() {
    const params = new URLSearchParams(location.search);
    const reservation = params.get('reserva') || params.get('external_reference');
    if (!reservation) return;
    $('returnCard').classList.remove('hidden');
    $('returnCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const paymentId = params.get('payment_id') || params.get('collection_id') || '';

    for (let i = 0; i < 8; i++) {
      try {
        const qs = new URLSearchParams({ reservation });
        if (paymentId) qs.set('payment_id', paymentId);
        const response = await fetch(`/api/payment-status?${qs}`, { cache: 'no-store' });
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
