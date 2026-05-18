/* ============================================================
   VASCA LASHES - Premium Animations, Loader & Social Proof
   ============================================================ */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

(function () {
  "use strict";

  const SUPABASE_URL = "https://mxoztaxlcciqrdejfpum.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14b3p0YXhsY2NpcXJkZWpmcHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTQ3NzksImV4cCI6MjA5NDE5MDc3OX0.bwE9e5P2UvqAC9VauZVk1q6j19mnDkAptXMOTEiKhJA";

  const FALLBACK_TESTIMONIALS = [
    { rating: 5, comment: "El resultado fue justo lo que buscaba. Natural y prolijo.", author_label: "Sofía M." },
    { rating: 5, comment: "El ambiente es súper tranquilo, te sentís cómoda desde que entrás.", author_label: "Lucía R." },
    { rating: 5, comment: "Se nota la técnica. Nada exagerado, todo bien hecho.", author_label: "Martina G." },
    { rating: 5, comment: "Volvería sin dudar. Atención y detalle en todo.", author_label: "Agustina C." },
    { rating: 5, comment: "Me encantó cómo quedó, pero también cómo me sentí durante todo el proceso.", author_label: "Julieta P." },
  ];

  function apiUrl(path) {
    const p = path.startsWith("/") ? path : `/${path}`;
    if (typeof window !== "undefined" && window.location.protocol === "file:") {
      const meta = document.querySelector('meta[name="vasca-api-origin"]');
      const origin = (meta && meta.content.trim()) || "http://localhost:3000";
      return `${origin.replace(/\/$/, "")}${p}`;
    }
    return p;
  }



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

  function initStaggeredCards() {
    const grids = document.querySelectorAll(".services-grid, .testimonials-grid, .community-gallery, .community-videos");

    grids.forEach((grid) => {
      const items = grid.children;
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const idx = Array.from(items).indexOf(entry.target);
              entry.target.style.animationDelay = `${idx * 0.1}s`;
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

  function initCursorGlow() {
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const glow = document.createElement("div");
    glow.classList.add("cursor-glow");
    document.body.appendChild(glow);

    let mouseX = 0;
    let mouseY = 0;
    let glowX = 0;
    let glowY = 0;

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
      glow.style.left = `${glowX}px`;
      glow.style.top = `${glowY}px`;
      requestAnimationFrame(animateGlow);
    }

    animateGlow();
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", (e) => {
        const target = document.querySelector(anchor.getAttribute("href"));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function initVideoAutoplay() {
    const videos = document.querySelectorAll(".video-card video");
    if (!videos.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.play().catch(() => {});
          else entry.target.pause();
        });
      },
      { threshold: 0.3 }
    );

    videos.forEach((video) => observer.observe(video));
  }

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

  function initCounters() {
    const counters = document.querySelectorAll("[data-count]");
    if (!counters.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
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
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach((counter) => observer.observe(counter));
  }

  async function loadServicesPreview() {
    const container = document.getElementById("services-preview");
    if (!container) return;

    try {
      const response = await fetch(apiUrl("/api/services"));
      const data = await response.json();
      container.innerHTML = "";
      data.services.forEach((service) => {
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
      });
    } catch {
      container.innerHTML = "<p class='section-copy'>No se pudieron cargar los servicios por ahora.</p>";
    }
  }

  function createStarsMarkup(rating) {
    const starSvg = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
    return starSvg.repeat(Math.max(1, Math.min(5, Number(rating) || 5)));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function quoteText(text) {
    return `“${text}”`;
  }

  function renderTestimonials(testimonials) {
    const grid = document.getElementById("testimonials-grid");
    if (!grid) return;

    if (!testimonials.length) {
      grid.innerHTML = "<p class='testimonial-empty'>Todavía no hay reseñas publicadas.</p>";
      return;
    }

    grid.innerHTML = testimonials.map((testimonial) => `
      <article class="testimonial-card">
        <div class="stars">${createStarsMarkup(testimonial.rating)}</div>
        <p class="testimonial-text">${quoteText(escapeHtml(testimonial.comment))}</p>
        <div class="testimonial-author">${escapeHtml(testimonial.author_label)}</div>
      </article>
    `).join("");
  }

  async function loadTestimonials() {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/reviews?select=rating,comment,author_label&is_published=eq.true&order=published_at.desc.nullslast,created_at.desc&limit=6`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      if (!response.ok) throw new Error("reviews_unavailable");
      const reviews = await response.json();

      if (!Array.isArray(reviews) || !reviews.length) {
        renderTestimonials(FALLBACK_TESTIMONIALS);
        return;
      }

      renderTestimonials(reviews);
    } catch {
      renderTestimonials(FALLBACK_TESTIMONIALS);
    }
  }

  function syncAuthLinks() {
    const token = localStorage.getItem("vasca_token");
    const role = localStorage.getItem("vasca_role");
    const navLink = document.getElementById("auth-link");
    const heroBtn = document.getElementById("hero-cta");

    if (!navLink || !heroBtn || !token) return;

    if (role === "admin") {
      navLink.href = "admin.html";
      navLink.textContent = "Admin";
      heroBtn.href = "admin.html";
      return;
    }

    if (role === "client") {
      navLink.href = "turnos.html";
      navLink.textContent = "Turnos";
      heroBtn.href = "turnos.html";
    }
  }


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
    loadTestimonials();
    syncAuthLinks();
    initNosotrosCarousel();
  });

  function initNosotrosCarousel() {
    const slides = document.querySelectorAll("#nosotros-carousel .carousel-slide");
    const dots = document.querySelectorAll("#carousel-dots .dot");
    if (!slides.length) return;

    let current = 0;
    const total = slides.length;

    function goTo(idx) {
      const prev = current;
      current = idx % total;
      if (prev === current) return;

      // Mark previous as fading out
      slides[prev].classList.remove("active");
      slides[prev].classList.add("fade-out");
      const prevVideo = slides[prev].querySelector("video");
      if (prevVideo) { prevVideo.pause(); }

      // Clean fade-out after transition
      setTimeout(() => {
        slides[prev].classList.remove("fade-out");
        if (prevVideo) prevVideo.currentTime = 0;
      }, 1000);

      // Activate new slide
      slides[current].classList.add("active");
      dots.forEach(d => d.classList.remove("active"));
      dots[current].classList.add("active");

      // Play video if active
      const video = slides[current].querySelector("video");
      if (video) video.play().catch(() => {});
    }

    // Auto-rotate every 3 seconds
    let timer = setInterval(() => goTo(current + 1), 4000);

    // Click on dots
    dots.forEach((dot, i) => {
      dot.addEventListener("click", () => {
        clearInterval(timer);
        goTo(i);
        timer = setInterval(() => goTo(current + 1), 4000);
      });
    });
  }
})();
