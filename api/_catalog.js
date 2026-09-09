const trips = [
  {
    id: 'morro-da-mesa-2026-09-20',
    title: 'Morro da Mesa',
    date: '2026-09-20',
    location: 'Poxoréu - MT',
    capacity: 100,
    level: 'Moderado a difícil',
    variants: [
      { id: 'onibus', name: 'Ônibus', pixPrice: 85, cardPrice: 85 },
      { id: 'carro', name: 'Carro próprio', pixPrice: 25, cardPrice: 25 }
    ]
  },
  {
    id: 'salto-das-nuvens-2026-10-10',
    title: 'Salto das Nuvens',
    date: '2026-10-10',
    location: 'Tangará da Serra - MT',
    capacity: 45,
    level: 'Passeio turístico',
    variants: [
      { id: 'individual', name: 'Individual', pixPrice: 520, cardPrice: 539 },
      { id: 'casal', name: 'Casal', pixPrice: 990, cardPrice: 1100 },
      { id: 'crianca', name: 'Criança até 10 anos', pixPrice: 450, cardPrice: 450 }
    ]
  },
  {
    id: 'outubro-rosa-2026-10-18',
    title: 'Outubro Rosa - Mirante da Janela',
    date: '2026-10-18',
    location: 'Rondonópolis - MT',
    capacity: 70,
    level: 'Moderado',
    variants: [
      { id: 'participacao', name: 'Participação', pixPrice: 30, cardPrice: 30 },
      { id: 'camiseta', name: 'Participação + camiseta', pixPrice: 75, cardPrice: 75 }
    ]
  },
  {
    id: 'nobres-2026-10-24',
    title: 'Nobres - Bom Jardim',
    date: '2026-10-24',
    location: 'Nobres / Bom Jardim - MT',
    capacity: 45,
    level: '2 dias',
    variants: [
      { id: 'individual', name: 'Individual', pixPrice: 890, cardPrice: 910 },
      { id: 'casal', name: 'Casal', pixPrice: 1600, cardPrice: 1700 }
    ]
  },
  {
    id: 'rio-cristalino-2026-11-08',
    title: 'Rio Cristalino + Aldeia Dom Bosco',
    date: '2026-11-08',
    location: 'Poxoréu - MT',
    capacity: 45,
    level: 'Fácil',
    variants: [
      { id: 'adulto', name: 'Adulto', pixPrice: 355, cardPrice: 369 },
      { id: 'crianca', name: 'Criança até 10 anos', pixPrice: 300, cardPrice: 300 }
    ]
  },
  {
    id: 'canion-das-indias-2026-11-15',
    title: 'Cânion das Índias',
    date: '2026-11-15',
    location: 'Jaciara - MT',
    capacity: 45,
    level: 'Moderado',
    variants: [
      { id: 'adulto', name: 'Adulto', pixPrice: 365, cardPrice: 389 }
    ]
  }
];

function getTrip(tripId) {
  return trips.find((trip) => trip.id === tripId);
}

function getVariant(trip, variantId) {
  return trip?.variants.find((variant) => variant.id === variantId);
}

module.exports = { trips, getTrip, getVariant };
