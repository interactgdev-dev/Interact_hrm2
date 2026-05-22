import LayoutDashboard from "../layout-dashboard";
import Image from "next/image";

export default function AdminPage() {
  return (
    <LayoutDashboard>
      <div style={{ background: '#fff', borderRadius: 18, boxShadow: '0 2px 12px rgba(0,82,204,0.08)', padding: 40, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Image src="/avatar.svg" alt="Admin" width={60} height={60} />
        <h2 style={{ color: '#0052CC', fontWeight: '700', fontSize: '1.1rem', marginTop: 16 }}>Admin</h2>
      </div>
    </LayoutDashboard>
  );
}