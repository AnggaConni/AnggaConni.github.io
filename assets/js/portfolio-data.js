/**
 * Portfolio JSON loader — pilot integration.
 * - Loads datasets from data/manifest.json
 * - Performs lightweight shape, unique-ID and cross-reference checks
 * - Hydrates the Education section only after the education dataset is valid
 * - Leaves existing static HTML intact as a fallback if loading fails
 */
(() => {
  "use strict";

  const MANIFEST_URL = "data/manifest.json";
  const REQUIRED_DATASETS = ["profile", "education", "experience", "competencies", "applications", "publications"];

  const getByPath = (root, path) => path.split(".").reduce((value, key) => value == null ? undefined : value[key], root);
  const text = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const hasUniqueIds = (items) => {
    if (!Array.isArray(items)) return false;
    const ids = items.map(item => item && (item.id ?? item.number)).filter(value => value !== undefined && value !== null);
    return ids.length === items.length && new Set(ids).size === ids.length;
  };

  async function fetchJson(path) {
    const response = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${path}`);
    return response.json();
  }

  function validateDatasets(data) {
    const errors = [];
    const warnings = [];
    const collections = {
      education: data.education?.education,
      coursework: data.education?.coursework || [],
      experiences: data.experience?.experiences,
      competencies: data.competencies?.competencies,
      applications: data.applications?.applications,
      authoredPublications: data.publications?.authoredPublications || [],
      editorialWorks: data.publications?.editorialWorks?.items || []
    };

    for (const name of REQUIRED_DATASETS) {
      if (!data[name] || typeof data[name] !== "object") errors.push(`Missing or invalid dataset: ${name}`);
      else if (!data[name].version) warnings.push(`Dataset has no version: ${name}`);
    }
    for (const [name, items] of Object.entries(collections)) {
      if (!Array.isArray(items)) errors.push(`Expected an array at ${name}`);
      else if (!hasUniqueIds(items)) errors.push(`Missing or duplicate IDs in ${name}`);
    }

    const appIds = new Set((collections.applications || []).map(item => item.id));
    const competencyIds = new Set((collections.competencies || []).map(item => item.id));
    const experienceIds = new Set((collections.experiences || []).map(item => item.id));

    // Validate known cross-reference fields without assuming every free-text skill is a competency ID.
    const walk = (value, location = "experience") => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${location}[${i}]`));
      for (const [key, child] of Object.entries(value)) {
        if (key === "relatedApplicationIds" && Array.isArray(child)) {
          child.forEach(id => { if (!appIds.has(id)) errors.push(`Broken application reference ${id} at ${location}`); });
        } else if (key === "relatedCompetencyIds" && Array.isArray(child)) {
          child.forEach(id => { if (!competencyIds.has(id)) errors.push(`Broken competency reference ${id} at ${location}`); });
        } else if (key === "relatedExperienceIds" && Array.isArray(child)) {
          child.forEach(id => { if (!experienceIds.has(id)) errors.push(`Broken experience reference ${id} at ${location}`); });
        } else {
          walk(child, `${location}.${key}`);
        }
      }
    };
    walk(data.experience);

    if (data.profile?.name == null) errors.push("Profile dataset is missing name");
    if (!Array.isArray(data.profile?.links)) warnings.push("Profile links are not an array");
    return { ok: errors.length === 0, errors, warnings, counts: Object.fromEntries(Object.entries(collections).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])) };
  }

  function renderExperience(dataset) {
    const section = document.querySelector('[data-json-source="experience"]');
    const timeline = section?.querySelector("[data-experience-timeline]");
    if (!timeline || !Array.isArray(dataset.experiences)) return false;

    const roles = dataset.experiences.filter(item => item && item.experienceType !== "cross-cutting");
    const crossCutting = dataset.experiences.filter(item => item && item.experienceType === "cross-cutting");

    const renderHighlight = item => {
      const area = item.area ? "<strong>" + text(item.area) + ":</strong> " : "";
      const link = item.url ? ' <a class="experience-evidence-link" href="' + text(item.url) + '" target="_blank" rel="noopener noreferrer">Explore related resource ↗</a>' : "";
      return "<li>" + area + text(item.detail || "") + link + "</li>";
    };

    const renderCard = (item, isCrossCutting = false) => {
      const highlights = Array.isArray(item.highlights) ? item.highlights : [];
      const visibleCount = isCrossCutting ? 4 : 3;
      const visible = highlights.slice(0, visibleCount);
      const remaining = highlights.slice(visibleCount);
      const tags = [...(Array.isArray(item.themes) ? item.themes : []), ...(Array.isArray(item.competencies) ? item.competencies : [])].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 8);
      const clients = Array.isArray(item.clients) && item.clients.length ? '<p><strong>Stakeholders:</strong> ' + text(item.clients.join(" · ")) + "</p>" : "";
      const moreHighlights = remaining.length ? '<details><summary>View ' + text(remaining.length) + ' more achievements</summary><ul class="experience-highlight-list">' + remaining.map(renderHighlight).join("") + "</ul></details>" : "";
      const competencyDetails = Array.isArray(item.competencies) && item.competencies.length ? '<details><summary>View competencies (' + text(item.competencies.length) + ')</summary><ul class="experience-highlight-list">' + item.competencies.map(value => "<li>" + text(value) + "</li>").join("") + "</ul></details>" : "";
      const period = item.period?.label || "";
      const heading = item.role || item.title || "Experience";
      let html = '<article class="experience-json-card' + (isCrossCutting ? " experience-cross-cutting" : "") + '">';
      html += '<span class="job-period">' + text(period) + "</span>";
      html += "<h3>" + text(heading) + "</h3>";
      html += '<span class="job-company">' + text(item.organisation || "") + (item.location ? " · " + text(item.location) : "") + "</span>";
      if (item.overview) html += "<p>" + text(item.overview) + "</p>";
      html += clients;
      if (visible.length) html += '<ul class="experience-highlight-list">' + visible.map(renderHighlight).join("") + "</ul>";
      html += moreHighlights + competencyDetails;
      if (tags.length) html += '<div class="experience-tags">' + tags.map(tag => '<span class="experience-tag">' + text(tag) + "</span>").join("") + "</div>";
      html += "</article>";
      return html;
    };

    const rolesHtml = roles.map(item => renderCard(item)).join("");
    const crossHtml = crossCutting.map(item => renderCard(item, true)).join("");
    timeline.innerHTML = rolesHtml + (crossHtml ? '<h3 class="experience-subheading">Cross-cutting Achievements</h3>' + crossHtml : "");
    return true;
  }

  function renderCompetencies(dataset) {
    const container = document.querySelector("[data-json-competencies]");
    const competencies = dataset?.competencies;
    if (!container || !Array.isArray(competencies)) return false;

    const iconClass = value => {
      const allowed = /^[a-z0-9-]+$/.test(value || "") ? value : "ph-lightbulb";
      return "ph " + allowed;
    };
    const categoryLabels = {
      policy: "Policy & Governance",
      methodology: "Methods & Intelligence",
      data: "Data & Analytics",
      technical: "Digital & Technical",
      sector: "Sector Expertise",
      professional: "Professional Practice",
      outputs: "Knowledge & Communication"
    };
    container.innerHTML = competencies.map(item => {
      const title = text(item.title || "Competency");
      const description = text(item.description || "");
      const tags = (Array.isArray(item.tags) ? item.tags : []).map(tag => '<span class="competency-tag">' + text(tag) + '</span>').join("");
      const category = item.category ? '<span class="tag">' + text(categoryLabels[item.category] || item.category) + '</span>' : "";
      const modal = item.modalId && document.getElementById(item.modalId)
        ? '<a class="competency-evidence-link" href="#" onclick="event.preventDefault(); event.stopPropagation(); openModal(\'' + text(item.modalId) + '\')">View detailed case examples ↗</a>'
        : "";
      const expanded = '<details><summary>Explore this competency</summary><div class="competency-details">' +
        (tags ? '<div class="competency-tags">' + tags + '</div>' : '<p>More structured focus areas can be added to this competency in the JSON dataset.</p>') +
        modal + '</div></details>';
      return '<article class="expert-card competency-card">' +
        '<i class="' + iconClass(item.icon) + '" aria-hidden="true"></i>' +
        category +
        '<h3>' + title + '</h3>' +
        '<p>' + description + '</p>' +
        expanded +
        '</article>';
    }).join("");
    return true;
  }

  function renderApplications(dataset) {
    const container = document.querySelector('[data-json-source="applications"]');
    const applications = dataset?.applications;
    if (!container || !Array.isArray(applications)) return false;

    const categoryLabels = Object.fromEntries(
      (Array.isArray(dataset.categories) ? dataset.categories : []).map(category => [category.id, category.label])
    );
    const fallbackImage = "thum/placeholder.png";
    const makeLink = link => {
      const label = text(link.label || "Open project");
      const url = text(link.url || "#");
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" class="text-sm font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 group">' +
        label + ' <span aria-hidden="true">↗</span></a>';
    };

    container.innerHTML = applications.map(app => {
      const links = Array.isArray(app.links) ? app.links.filter(link => link && link.url) : [];
      const primaryUrl = links[0]?.url || "#";
      const category = text(app.category || "tools");
      const tags = (Array.isArray(app.tags) ? app.tags : []).map(tag =>
        '<span class="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">' + text(tag) + '</span>'
      ).join("");
      const badge = app.badge
        ? '<div class="absolute top-3 right-3 z-30"><span class="text-[10px] font-bold px-2.5 py-1 rounded-full border shadow-sm backdrop-blur-sm ' +
          (app.badge.status === "testing" ? "bg-amber-50 text-amber-800 border-amber-200" :
           app.badge.status === "coming-soon" ? "bg-slate-50 text-slate-700 border-slate-200" :
           "bg-blue-50 text-blue-700 border-blue-200") + '">' + text(app.badge.label) + '</span></div>'
        : "";
      const image = app.image ? text(app.image) : "";
      const imageUrl = image || ("https://api.microlink.io/?url=" + encodeURIComponent(primaryUrl) + "&embed=image.url");
      const imageHtml = '<img src="' + imageUrl + '" data-fallback-step="' + (image ? "1" : "2") + '" data-target-url="' + text(primaryUrl) + '" alt="' + text(app.title) + '" loading="lazy" class="w-full h-full object-cover object-top hover:scale-105 transition-transform duration-700 relative z-10" onerror="imageFallback(this)">';
      return '<div class="portfolio-item snap-center shrink-0 w-[300px] md:w-[350px] flex flex-col relative pt-8 md:pt-16 group" data-category="' + category + '">' +
        '<div class="absolute top-[31px] left-1/2 -translate-x-1/2 w-5 h-5 bg-white border-4 border-indigo-500 rounded-full z-10 hidden md:block group-hover:scale-125 group-hover:border-indigo-600 transition-transform"></div>' +
        '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col h-full overflow-hidden">' +
        '<div class="w-full h-44 bg-slate-100 overflow-hidden relative border-b border-slate-100 shrink-0 group-img">' + badge + imageHtml + '</div>' +
        '<div class="p-6 flex flex-col flex-grow"><span class="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-2">' + text(categoryLabels[app.category] || app.category || "Project") + '</span>' +
        '<h3 class="text-xl font-bold text-slate-900 mb-2 leading-tight" title="' + text(app.title) + '">' + text(app.title || "Untitled application") + '</h3>' +
        '<p class="text-slate-600 text-sm mb-4 line-clamp-3 flex-grow" title="' + text(app.description || "") + '">' + text(app.description || "") + '</p>' +
        '<div class="flex flex-wrap gap-1.5 mb-5">' + tags + '</div>' +
        '<div class="mt-auto pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3">' + links.map(makeLink).join('<span class="text-slate-300">|</span>') + '</div>' +
        '</div></div></div>';
    }).join("");

    const emptyState = document.getElementById("empty-state");
    const activeFilter = document.querySelector("#filter-container .filter-btn.active")?.getAttribute("data-filter") || "all";
    let visible = 0;
    container.querySelectorAll(".portfolio-item").forEach(item => {
      const show = activeFilter === "all" || item.getAttribute("data-category") === activeFilter;
      item.classList.toggle("hide-item", !show);
      if (show) visible++;
    });
    if (emptyState) emptyState.classList.toggle("hidden", visible > 0);
    return true;
  }

  function renderEditorialWorks(dataset) {
    const tbody = document.querySelector("[data-json-editorial-works]");
    const works = dataset?.editorialWorks?.items;
    if (!tbody || !Array.isArray(works)) return false;

    const rows = [...works]
      .sort((a, b) => Number(a.number) - Number(b.number))
      .map(item => {
        const title = text(item.title || "Untitled publication");
        const isbn = item.isbn ? '<span class="isbn-code">' + text(item.isbn) + "</span>" : "—";
        const metadata = [item.year, item.authors].filter(Boolean).map(text).join(" · ");
        const metaHtml = metadata ? '<span class="editorial-meta">' + metadata + "</span>" : "";
        return "<tr><td>" + text(item.number) + '</td><td><span class="editorial-title">' + title + "</span>" + metaHtml + "</td><td>" + isbn + "</td></tr>";
      }).join("");

    tbody.innerHTML = rows || '<tr><td colspan="3">No editorial works are available.</td></tr>';
    const heading = document.querySelector('[data-editorial-heading]');
    if (heading) heading.textContent = "Editorial Works - Copy Editor (" + works.length + " Titles)";
    return true;
  }

  function renderEducation(dataset) {
    const section = document.querySelector('[data-json-source="education"]');
    const timeline = section?.querySelector(".timeline");
    const courseworkContainer = section?.querySelector("[data-json-coursework]");
    if (!timeline || !Array.isArray(dataset.education)) return false;

    const cards = dataset.education.map(item => {
      const period = item.period?.label || [item.period?.start, item.period?.end].filter(Boolean).join("–");
      const gpa = item.gpa && Number.isFinite(Number(item.gpa.value))
        ? "<strong>GPA: " + text(item.gpa.value) + " / " + text(item.gpa.scale || 4) + "</strong><br>"
        : "";
      const thesis = item.thesis ? "Thesis: \"" + text(item.thesis) + "\"<br>" : "";
      const focus = item.focus ? "Focus: " + text(item.focus) + "<br>" : "";
      const relevance = item.relevance ? "<em>Strategic Relevance: " + text(item.relevance) + "</em>" : "";
      return '<div class="edu-item"><h3>' + text(item.degree) + '</h3><div class="edu-meta">' + text(item.institution) + " | " + text(period) + '</div><div class="edu-desc">' + gpa + thesis + focus + relevance + "</div></div>";
    }).join("");
    timeline.innerHTML = cards || timeline.innerHTML;

    if (courseworkContainer && Array.isArray(dataset.coursework)) {
      const allowed = ["binus-communication-studies-enrollment", "unas-communication-coursework", "mercubuana-communication-coursework"];
      const records = dataset.coursework.filter(item => item && allowed.includes(item.id));
      const courseworkCards = records.map(item => {
        const isEnrollment = item.status === "discontinued";
        const statusLabel = isEnrollment ? "Enrollment record · not a completed degree" : "Transcript-supported coursework";
        const stats = [];
        if (Number.isFinite(Number(item.creditsCompleted))) stats.push(text(item.creditsCompleted) + " SKS");
        if (item.gpa && Number.isFinite(Number(item.gpa.value))) stats.push("GPA " + text(item.gpa.value) + " / " + text(item.gpa.scale || 4));
        if (item.entryPeriod) stats.push("Entry " + text(item.entryPeriod));
        if (item.enrollmentDate) stats.push("Entry " + text(item.enrollmentDate));
        const detail = item.note || item.verificationNote || "";
        const status = item.statusAsReported ? "<br>Recorded status: " + text(item.statusAsReported) : "";
        return '<article class="coursework-card"><h4>' + text(item.studyProgram || item.title) + '</h4><div class="coursework-institution">' + text(item.institution) + '</div><div class="coursework-stats"><span class="coursework-stat">' + text(statusLabel) + "</span>" + stats.map(value => '<span class="coursework-stat">' + value + "</span>").join("") + '</div><div class="coursework-note">' + text(detail) + status + "</div></article>";
      }).join("");
      courseworkContainer.innerHTML = courseworkCards ? '<h3 class="coursework-heading">Additional Academic Coursework &amp; Enrollment</h3><p class="education-coursework-intro">Additional study records are shown separately from completed degrees. Credit totals and grades are displayed only where supported by the available records.</p><div class="coursework-grid">' + courseworkCards + "</div>" : "";
    }
    return true;
  }

  async function initPortfolioData() {
    try {
      const manifest = await fetchJson(MANIFEST_URL);
      if (!manifest.datasets || typeof manifest.datasets !== "object") throw new Error("Manifest has no datasets map");
      const entries = Object.entries(manifest.datasets);
      const loaded = await Promise.all(entries.map(async ([key, path]) => [key, await fetchJson(path)]));
      const data = Object.fromEntries(loaded);
      const report = validateDatasets(data);
      window.portfolioData = data;
      window.portfolioDataValidation = report;
      document.dispatchEvent(new CustomEvent("portfolio:data-ready", { detail: { data, validation: report } }));

      if (report.errors.length) console.error("[Portfolio JSON] Validation errors:", report.errors);
      if (report.warnings.length) console.warn("[Portfolio JSON] Validation warnings:", report.warnings);
      console.info("[Portfolio JSON] Loaded datasets:", report.counts);

      // Keep the static Education section as a graceful fallback if the dataset fails validation.
      if (!report.errors.length) {
        renderEducation(data.education);
        renderExperience(data.experience);
        renderCompetencies(data.competencies);
        renderEditorialWorks(data.publications);
        renderApplications(data.applications);
      }
    } catch (error) {
      console.warn("[Portfolio JSON] Loader failed; existing static HTML remains active.", error);
      document.dispatchEvent(new CustomEvent("portfolio:data-error", { detail: { message: error.message } }));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPortfolioData, { once: true });
  } else {
    initPortfolioData();
  }
})();
