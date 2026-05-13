/* ═══════════════════════════════════════════════════════════
   VASCA LASHES — Premium Animations & Interactions
   ═══════════════════════════════════════════════════════════ */

// PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

(function () {
  "use strict";

  // ─── API HELPER ────────────────────────────────────────
  function apiUrl(path) {
    const p = path.startsWith("/") ? path : `/${path}`;
    if (typeof window !== "undefined" && window.location.protocol === "file:") {
      const meta = document.querySelector('meta[name="vasca-api-origin"]');
      const origin = (meta && meta.content.trim()) || "http://localhost:3000";
      return `${origin.replace(/\/$/, "")}${p}`;
    }
    return p;
  }

  // ─── SCROLL REVEAL (IntersectionObserver) ──────────────
  function initScrollReveal() {
    const revealEls = document.querySelectorAll(".reveal, .reveal-left, .reveal-right, .reveal-scale");
    if (!revealEls.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach((el) => observer.observe(el));
  }

  // ─── STAGGERED CARDS ──────────────────────────────────
  function initStaggeredCards() {
    const grids = document.querySelectorAll(".services-grid, .testimonials-grid, .community-gallery, .community-videos");
    
    grids.forEach((grid) => {
      const items = grid.children;
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const idx = Array.from(items).indexOf(entry.target);
              entry.target.style.transitionDelay = `${idx * 0.1}s`;
              entry.target.classList.add("visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.08 }
      );

      Array.from(items).forEach((item) => {
        item.classList.add("reveal");
        observer.observe(item);
      });
    });
  }

  // ─── TOPBAR SCROLL EFFECT ─────────────────────────────
  function initTopbarScroll() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;

    let ticking = false;
    window.addEventListener("scroll", () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          topbar.classList.toggle("scrolled", window.scrollY > 60);
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  // ─── CURSOR GLOW (desktop only) ───────────────────────
  function initCursorGlow() {
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const glow = document.createElement("div");
    glow.classList.add("cursor-glow");
    document.body.appendChild(glow);

    let mouseX = 0, mouseY = 0, glowX = 0, glowY = 0;

    document.addEventListener("mousemove", (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      glow.classList.add("active");
    });

    document.addEventListener("mouseleave", () => {
      glow.classList.remove("active");
    });

    function animateGlow() {
      glowX += (mouseX - glowX) * 0.08;
      glowY += (mouseY - glowY) * 0.08;
      glow.style.left = glowX + "px";
      glow.style.top = glowY + "px";
      requestAnimationFrame(animateGlow);
    }
    animateGlow();
  }

  // ─── SMOOTH ANCHOR SCROLL ────────────────────────────
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", (e) => {
        const target = document.querySelector(anchor.getAttribute("href"));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  // ─── VIDEO AUTOPLAY ON SCROLL ─────────────────────────
  function initVideoAutoplay() {
    const videos = document.querySelectorAll(".video-card video");
    if (!videos.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.play().catch(() => {});
          } else {
            entry.target.pause();
          }
        });
      },
      { threshold: 0.3 }
    );

    videos.forEach((video) => observer.observe(video));
  }

  // ─── PARALLAX SUBTLE ─────────────────────────────────
  function initParallax() {
    const hero = document.querySelector(".hero");
    if (!hero) return;

    window.addEventListener("scroll", () => {
      requestAnimationFrame(() => {
        const scrolled = window.scrollY;
        if (scrolled < window.innerHeight) {
          const card = hero.querySelector(".hero-card");
          if (card) {
            card.style.transform = `translateY(${scrolled * 0.06}px)`;
          }
        }
      });
    });
  }

  // ─── COUNTER ANIMATION ───────────────────────────────
  function initCounters() {
    const counters = document.querySelectorAll("[data-count]");
    if (!counters.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const target = parseInt(el.dataset.count, 10);
            let current = 0;
            const step = Math.max(1, Math.floor(target / 60));
            const timer = setInterval(() => {
              current += step;
              if (current >= target) {
                current = target;
                clearInterval(timer);
              }
              el.textContent = current.toLocaleString("es-AR");
            }, 20);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach((c) => observer.observe(c));
  }

  // ─── LOAD SERVICES PREVIEW ───────────────────────────
  async function loadServicesPreview() {
    const container = document.getElementById("services-preview");
    if (!container) return;

    try {
      const response = await fetch(apiUrl("/api/services"));
      const data = await response.json();
      container.innerHTML = "";
      for (const service of data.services) {
        const card = document.createElement("a");
        card.className = "service-card";
        card.href = "https://www.instagram.com/vasca.lashes/";
        card.target = "_blank";
        card.rel = "noreferrer";
        card.innerHTML = `
          <h3>${service.name}</h3>
          <p>${service.description || ""}</p>
          <strong>$${service.price_ars.toLocaleString("es-AR")} · ${service.duration_minutes} min</strong><br>
          <small>Ver ejemplos en Instagram</small>
        `;
        container.appendChild(card);
      }
    } catch {
      container.innerHTML = "<p class='section-copy'>No se pudieron cargar los servicios por ahora.</p>";
    }
  }

  // ─── INIT ALL ─────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    initScrollReveal();
    initStaggeredCards();
    initTopbarScroll();
    initCursorGlow();
    initSmoothScroll();
    initVideoAutoplay();
    initParallax();
    initCounters();
    loadServicesPreview();
  });
})();
