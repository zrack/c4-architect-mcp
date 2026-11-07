// Synthetic graphs for renderer stress testing, not architecture extracted from
// this repository. The larger graph extends the same order-processing example.
const component = (id, label, description) => ({
  id, label, type: 'Component', technology: 'TypeScript / Node.js',
  ...(description ? { description } : {}),
});
const relationship = (from, to, label, technology = 'Internal module call') => ({
  from, to, label, technology,
});

const nodes = [
  component('gateway', 'Order API gateway', 'Routes incoming order requests'),
  component('validator', 'Request validation'),
  component('auth', 'Authorization policy'),
  component('orders', 'Order orchestration', 'Coordinates pricing, stock and payment'),
  component('pricing', 'Pricing calculation'),
  component('inventory', 'Inventory reservation'),
  component('payments', 'Payment integration adapter'),
  component('worker', 'Fulfilment worker', 'Retries failed deliveries'),
  component('events', 'Domain event publisher'),
  component('repository', 'Order repository'),
  { id: 'database', label: 'Order database', type: 'ContainerDb', technology: 'PostgreSQL' },
  { id: 'provider', label: 'Payment provider', type: 'ExternalSystem', technology: 'HTTPS / JSON' },
];
const relationships = [
  relationship('gateway', 'validator', 'Validates request payload'),
  relationship('gateway', 'auth', 'Checks order permissions'),
  relationship('gateway', 'orders', 'Submits validated order'),
  relationship('orders', 'pricing', 'Calculates customer price'),
  relationship('orders', 'inventory', 'Reserves available stock'),
  relationship('orders', 'payments', 'Requests payment authorization'),
  relationship('orders', 'repository', 'Persists order state'),
  relationship('orders', 'events', 'Publishes order accepted'),
  relationship('pricing', 'repository', 'Reads pricing adjustments'),
  relationship('inventory', 'repository', 'Records stock reservations'),
  relationship('payments', 'provider', 'Authorizes via @enterprise/payment-authorization-sdk', 'HTTPS / JSON'),
  relationship('payments', 'provider', 'Captures authorized payment', 'HTTPS / JSON'),
  relationship('payments', 'orders', 'Returns authorization outcome'),
  relationship('repository', 'database', 'Reads and writes order records', 'SQL / TCP'),
  relationship('events', 'worker', 'Delivers fulfilment command', 'Asynchronous event'),
  relationship('worker', 'inventory', 'Commits stock reservation'),
  relationship('worker', 'repository', 'Updates delivery status'),
  relationship('worker', 'events', 'Publishes delivery completed', 'Asynchronous event'),
  relationship('worker', 'worker', 'Retries with exponential backoff'),
  relationship('auth', 'repository', 'Verifies order ownership'),
];

export const componentScaleFixtures = [
  {
    name: 'component-12',
    diagram: { title: 'Order Processing - Component Layout Test (12 nodes)', c4Level: 'C4Component', nodes, relationships },
  },
  {
    name: 'component-20',
    diagram: {
      title: 'Order Processing - Component Layout Test (20 nodes)',
      c4Level: 'C4Component',
      nodes: [
        ...nodes,
        component('catalog', 'Product catalog'),
        { id: 'products', label: 'Product database', type: 'ContainerDb', technology: 'PostgreSQL' },
        component('customers', 'Customer profile'),
        component('fraud', 'Fraud assessment', 'Checks identity and payment risk'),
        component('templates', 'Notification rendering'),
        component('notifications', 'Notification worker'),
        { id: 'email', label: 'Email delivery provider', type: 'System_Ext', technology: 'HTTPS / JSON' },
        component('audit', 'Audit trail recorder'),
      ],
      relationships: [
        ...relationships,
        relationship('gateway', 'catalog', 'Looks up orderable products'),
        relationship('orders', 'customers', 'Loads customer preferences'),
        relationship('orders', 'fraud', 'Requests payment risk decision'),
        relationship('fraud', 'customers', 'Checks customer history'),
        relationship('fraud', 'payments', 'Checks authorization signals'),
        relationship('catalog', 'products', 'Reads product definitions', 'SQL / TCP'),
        relationship('pricing', 'catalog', 'Loads current product prices'),
        relationship('inventory', 'products', 'Reads stock keeping units', 'SQL / TCP'),
        relationship('events', 'notifications', 'Queues order confirmation', 'Asynchronous event'),
        relationship('notifications', 'templates', 'Renders localized confirmation'),
        relationship('templates', 'customers', 'Loads customer language'),
        relationship('notifications', 'email', 'Sends confirmation email', 'HTTPS / JSON'),
        relationship('orders', 'audit', 'Records order transitions'),
        relationship('payments', 'audit', 'Records payment outcome'),
        relationship('audit', 'database', 'Appends immutable audit record', 'SQL / TCP'),
      ],
    },
  },
];
