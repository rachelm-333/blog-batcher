import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { useEffect } from "react";

/**
 * Home — landing page / auth redirect
 * If the user is already authenticated, redirect to /dashboard.
 * Otherwise show the Blog Batcher landing page.
 */
export default function Home() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user) {
      setLocation("/dashboard");
    }
  }, [user, loading, setLocation]);

  if (loading) {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#faf9f5" }}>
        <div style={{ width:32, height:32, border:"3px solid #6e5afe", borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (user) return null; // redirecting

  return (
    <div style={{ minHeight:"100vh", background:"#faf9f5", fontFamily:"Inter, sans-serif" }}>
      {/* Nav */}
      <nav style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"0 32px", display:"flex", alignItems:"center", height:60 }}>
        <span style={{ fontFamily:"'Lora', serif", fontStyle:"italic", fontWeight:700, fontSize:22, color:"#6e5afe" }}>
          Blog Batcher
        </span>
        <div style={{ marginLeft:"auto", display:"flex", gap:12 }}>
          <a href="/login" style={{ padding:"8px 18px", borderRadius:8, border:"1.5px solid #6e5afe", color:"#6e5afe", fontWeight:600, fontSize:14, textDecoration:"none", background:"transparent" }}>
            Log in
          </a>
          <a href="/register" style={{ padding:"8px 18px", borderRadius:8, background:"#6e5afe", color:"#fff", fontWeight:600, fontSize:14, textDecoration:"none" }}>
            Start free trial
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth:900, margin:"0 auto", padding:"80px 32px 60px", textAlign:"center" }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:99, background:"#D9F542", color:"#1a1a2e", fontSize:12, fontWeight:700, marginBottom:24 }}>
          ✦ AI-powered blog batch generation
        </div>
        <h1 style={{ fontFamily:"'Lora', serif", fontStyle:"italic", fontWeight:700, fontSize:52, color:"#1a1a2e", lineHeight:1.15, margin:"0 0 20px" }}>
          Build a full blog strategy<br />in one afternoon.
        </h1>
        <p style={{ fontSize:18, color:"#6b7280", maxWidth:560, margin:"0 auto 36px", lineHeight:1.6 }}>
          Blog Batcher takes you from business profile to 20+ published, SEO-optimised articles — keyword research, architecture, generation, review, and scheduling all in one workflow.
        </p>
        <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
          <a href="/register" style={{ padding:"14px 32px", borderRadius:10, background:"#6e5afe", color:"#fff", fontWeight:700, fontSize:16, textDecoration:"none", boxShadow:"0 4px 14px rgba(110,90,254,0.35)" }}>
            Start free trial →
          </a>
          <a href="/login" style={{ padding:"14px 32px", borderRadius:10, border:"1.5px solid #d1d5db", color:"#374151", fontWeight:600, fontSize:16, textDecoration:"none", background:"#fff" }}>
            Log in
          </a>
        </div>
      </section>

      {/* Feature grid */}
      <section style={{ maxWidth:900, margin:"0 auto", padding:"0 32px 80px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:20 }}>
          {[
            { icon:"🎯", title:"Keyword Research", desc:"DataForSEO-powered keyword discovery with cannibalization checks built in." },
            { icon:"🏗️", title:"Blog Architecture", desc:"Cornerstone → Pillar → Cluster structure auto-generated for your niche." },
            { icon:"✍️", title:"AI Article Generation", desc:"Brand-voice-matched articles scored above 85 SEO before you see them." },
            { icon:"📅", title:"Publish & Schedule", desc:"Connect WordPress or Wix and schedule your entire batch in one click." },
          ].map(f => (
            <div key={f.title} style={{ background:"#fff", borderRadius:12, padding:"24px", border:"1px solid #e5e7eb" }}>
              <div style={{ fontSize:28, marginBottom:12 }}>{f.icon}</div>
              <div style={{ fontWeight:700, fontSize:15, color:"#1a1a2e", marginBottom:6 }}>{f.title}</div>
              <div style={{ fontSize:13, color:"#6b7280", lineHeight:1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop:"1px solid #e5e7eb", padding:"20px 32px", textAlign:"center", fontSize:12, color:"#9ca3af" }}>
        © {new Date().getFullYear()} Blog Batcher. All rights reserved.
      </footer>
    </div>
  );
}
