import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Roove',
  description: 'Kebijakan Privasi Roove',
};

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.7, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8, color: '#f1f5f9' }}>Privacy Policy</h1>
      <p style={{ color: '#94a3b8', marginBottom: 32 }}>Last updated: April 7, 2026</p>

      <p>
        PT Roove Tijara Internasional (&quot;Roove&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the Roove BI platform
        at <strong>roove.info</strong> and related services. This Privacy Policy explains how we collect, use, and
        protect your information when you use our services.
      </p>

      <h2>1. Information We Collect</h2>
      <p>We may collect the following types of information:</p>
      <ul>
        <li><strong>Account Information</strong> — name, email address, phone number, and role when you register or are invited to the platform.</li>
        <li><strong>Usage Data</strong> — pages visited, features used, timestamps, device type, and browser information collected automatically.</li>
        <li><strong>Business Data</strong> — sales orders, customer records, product data, and other business information you or your organization upload or connect to the platform.</li>
        <li><strong>Third-Party Integrations</strong> — data received from connected services such as ScaleV, WhatsApp Business API, or e-commerce platforms, as authorized by your organization.</li>
      </ul>

      <h2>2. How We Use Your Information</h2>
      <p>We use the collected information to:</p>
      <ul>
        <li>Provide, operate, and maintain the Roove BI platform.</li>
        <li>Generate analytics, dashboards, and business intelligence reports for your organization.</li>
        <li>Authenticate users and manage access permissions.</li>
        <li>Send service-related notifications (e.g., alerts, system updates).</li>
        <li>Improve and develop new features based on usage patterns.</li>
        <li>Comply with legal obligations.</li>
      </ul>

      <h2>3. Data Sharing</h2>
      <p>We do <strong>not</strong> sell your personal data. We may share information only in the following circumstances:</p>
      <ul>
        <li><strong>Within your organization</strong> — data is accessible to authorized members of your organization based on their assigned roles.</li>
        <li><strong>Service providers</strong> — we use trusted third-party services (e.g., Supabase for hosting, Vercel for deployment) that process data on our behalf under strict confidentiality agreements.</li>
        <li><strong>AI assistants</strong> — when you interact with AI-powered features (e.g., GPT-based analysis), relevant business data may be sent to AI providers (OpenAI, Anthropic) to generate responses. No personal customer data is sent without your organization&apos;s configuration and consent.</li>
        <li><strong>Legal requirements</strong> — if required by law, regulation, or legal process.</li>
      </ul>

      <h2>4. Data Security</h2>
      <p>
        We implement industry-standard security measures including encrypted connections (TLS/SSL),
        role-based access control, and secure authentication. Business data is stored in managed
        database infrastructure with automated backups and access logging.
      </p>

      <h2>5. Data Retention</h2>
      <p>
        We retain your data for as long as your organization&apos;s account is active or as needed to provide
        services. Upon account termination, data will be deleted within 90 days unless retention is
        required by law.
      </p>

      <h2>6. Your Rights</h2>
      <p>Depending on your jurisdiction, you may have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you.</li>
        <li>Request correction of inaccurate data.</li>
        <li>Request deletion of your data.</li>
        <li>Object to or restrict certain processing.</li>
        <li>Withdraw consent where processing is based on consent.</li>
      </ul>
      <p>To exercise these rights, contact us at the email below.</p>

      <h2>7. Cookies</h2>
      <p>
        We use essential cookies for authentication and session management. We do not use third-party
        tracking or advertising cookies.
      </p>

      <h2>8. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes will be posted on this page with
        an updated &quot;Last updated&quot; date. Continued use of the platform after changes constitutes
        acceptance of the updated policy.
      </p>

      <h2>9. Contact Us</h2>
      <p>
        If you have questions about this Privacy Policy, please contact us at:
      </p>
      <p>
        <strong>PT Roove Tijara Internasional</strong><br />
        Email: <a href="mailto:hello@roove.info" style={{ color: '#2563eb' }}>hello@roove.info</a>
      </p>
    </div>
  );
}
