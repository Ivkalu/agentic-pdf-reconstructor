/* global document, window, fetch, FormData, URL, Blob, atob, Uint8Array */
"use strict";

(function () {
  // ───── Helpers ─────

  function $(selector) {
    return document.querySelector(selector);
  }

  function show(el) {
    el.hidden = false;
  }

  function hide(el) {
    el.hidden = true;
  }

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m > 0 ? m + "m " + s + "s" : s + "s";
  }

  function timeAgo(dateStr) {
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    return days + "d ago";
  }

  // ───── Tab Switching ─────

  var tabButtons = document.querySelectorAll(".tabs__btn");
  var tabPanels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-tab");

      tabButtons.forEach(function (b) {
        b.classList.remove("tabs__btn--active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("tabs__btn--active");
      btn.setAttribute("aria-selected", "true");

      tabPanels.forEach(function (panel) {
        panel.classList.remove("tab-panel--active");
      });
      document.getElementById("tab-" + target).classList.add("tab-panel--active");
    });
  });

  // ───── Shared: Drag-and-Drop Setup ─────

  function setupDropzone(config) {
    var dropzone = $(config.dropzoneSelector);
    var fileInput = $(config.fileInputSelector);
    var browseBtn = $(config.browseBtnSelector);
    var fileInfo = $(config.fileInfoSelector);
    var fileName = $(config.fileNameSelector);
    var fileRemove = $(config.fileRemoveSelector);
    var processBtn = $(config.processBtnSelector);

    var selectedFile = null;

    function setFile(file) {
      if (!config.validate(file)) {
        return;
      }
      selectedFile = file;
      fileName.textContent = file.name + " (" + (file.size / (1024 * 1024)).toFixed(1) + " MB)";
      show(fileInfo);
      hide(dropzone);
      processBtn.disabled = false;
    }

    function clearFile() {
      selectedFile = null;
      fileInput.value = "";
      hide(fileInfo);
      show(dropzone);
      processBtn.disabled = true;
    }

    function getFile() {
      return selectedFile;
    }

    // Click to browse
    browseBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      fileInput.click();
    });

    dropzone.addEventListener("click", function () {
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) {
        setFile(fileInput.files[0]);
      }
    });

    // Remove
    fileRemove.addEventListener("click", clearFile);

    // Drag events
    ["dragenter", "dragover"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("dropzone--active");
      });
    });

    ["dragleave", "drop"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("dropzone--active");
      });
    });

    dropzone.addEventListener("drop", function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) {
        setFile(files[0]);
      }
    });

    return { getFile: getFile, clearFile: clearFile };
  }

  // ───── Job History ─────

  function loadJobHistory() {
    fetch("/api/jobs")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success || !data.data || data.data.length === 0) {
          hide($("#jobs-history"));
          return;
        }

        var list = $("#jobs-list");
        list.innerHTML = "";

        // Show up to 10 recent jobs
        var jobs = data.data.slice(0, 10);

        jobs.forEach(function (job) {
          var item = document.createElement("div");
          item.className = "job-item";

          var typeLabel = job.type === "pdf-reconstruction" ? "PDF" : "Video";

          item.innerHTML =
            '<span class="job-item__type">' + typeLabel + '</span>' +
            '<span class="job-item__id">' + job.id + '</span>' +
            '<span class="job-item__status job-item__status--' + job.status + '">' + job.status + '</span>' +
            '<span class="job-item__time">' + timeAgo(job.createdAt) + '</span>';

          item.addEventListener("click", function () {
            onJobClick(job);
          });

          list.appendChild(item);
        });

        show($("#jobs-history"));
      })
      .catch(function () {
        // Silently ignore — history is not critical
      });
  }

  function switchToTab(tabName) {
    tabButtons.forEach(function (b) {
      b.classList.remove("tabs__btn--active");
      b.setAttribute("aria-selected", "false");
    });
    var btn = document.querySelector('[data-tab="' + tabName + '"]');
    btn.classList.add("tabs__btn--active");
    btn.setAttribute("aria-selected", "true");
    tabPanels.forEach(function (p) { p.classList.remove("tab-panel--active"); });
    document.getElementById("tab-" + tabName).classList.add("tab-panel--active");
  }

  function resetPanelState(section) {
    hide($("#" + section + "-progress"));
    hide($("#" + section + "-result"));
    hide($("#" + section + "-error"));
  }

  function onJobClick(job) {
    if (job.type === "pdf-reconstruction") {
      switchToTab("pdf");
      resetPanelState("pdf");

      if (job.status === "processing") {
        pollPdfResult(job.id);
      } else if (job.status === "completed") {
        fetch("/api/pdf-reconstruction/result/" + encodeURIComponent(job.id))
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data.success && data.data && data.data.status === "completed") {
              displayPdfResult(job.id, data.data);
            } else if (data.error) {
              showError("pdf", data.error);
            }
          })
          .catch(function (err) {
            showError("pdf", err.message || "Failed to load job result.");
          });
      } else if (job.status === "failed") {
        showError("pdf", job.error || "Job failed");
      }
    } else if (job.type === "video-analyzer") {
      switchToTab("video");
      resetPanelState("video");

      if (job.status === "processing") {
        pollVideoResult(job.id);
      } else if (job.status === "completed") {
        fetch("/api/video-analyzer/result/" + encodeURIComponent(job.id))
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data.success && data.data && data.data.status === "completed") {
              displayVideoResult(job.id, data.data);
            } else if (data.error) {
              showError("video", data.error);
            }
          })
          .catch(function (err) {
            showError("video", err.message || "Failed to load job result.");
          });
      } else if (job.status === "failed") {
        showError("video", job.error || "Job failed");
      }
    }
  }

  $("#jobs-refresh-btn").addEventListener("click", loadJobHistory);

  // Load job history on page load
  loadJobHistory();

  // ───── PDF Reconstruction ─────

  var pdfDropzone = setupDropzone({
    dropzoneSelector: "#pdf-dropzone",
    fileInputSelector: "#pdf-file-input",
    browseBtnSelector: "#pdf-browse-btn",
    fileInfoSelector: "#pdf-file-info",
    fileNameSelector: "#pdf-file-name",
    fileRemoveSelector: "#pdf-file-remove",
    processBtnSelector: "#pdf-process-btn",
    validate: function (file) {
      var allowed = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];
      if (allowed.indexOf(file.type) === -1) {
        showError("pdf", "Invalid file type. Please upload an image (PNG, JPG, GIF, WebP, or BMP).");
        return false;
      }
      if (file.size > 20 * 1024 * 1024) {
        showError("pdf", "File is too large. Maximum size is 20 MB.");
        return false;
      }
      return true;
    },
  });

  $("#pdf-process-btn").addEventListener("click", function () {
    var file = pdfDropzone.getFile();
    if (!file) return;
    startPdfJob(file);
  });

  function startPdfJob(file) {
    var processBtn = $("#pdf-process-btn");
    var progress = $("#pdf-progress");
    var result = $("#pdf-result");
    var error = $("#pdf-error");

    processBtn.disabled = true;
    hide(error);
    hide(result);
    show(progress);

    var formData = new FormData();
    formData.append("file", file);

    fetch("/api/pdf-reconstruction/upload", {
      method: "POST",
      body: formData,
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) {
          throw new Error(data.error || "Upload failed");
        }
        pollPdfResult(data.data.jobId);
        // Refresh job history after starting a new job
        loadJobHistory();
      })
      .catch(function (err) {
        hide(progress);
        processBtn.disabled = false;
        showError("pdf", err.message || "Failed to upload file.");
      });
  }

  function pollPdfResult(jobId) {
    var progress = $("#pdf-progress");
    var processBtn = $("#pdf-process-btn");

    show(progress);

    var pollInterval = setInterval(function () {
      fetch("/api/pdf-reconstruction/result/" + encodeURIComponent(jobId))
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          if (!data.success && data.error) {
            clearInterval(pollInterval);
            hide(progress);
            processBtn.disabled = false;
            showError("pdf", data.error);
            loadJobHistory();
            return;
          }

          if (data.data && data.data.status === "processing") {
            return; // keep polling
          }

          clearInterval(pollInterval);
          hide(progress);
          processBtn.disabled = false;

          if (data.data && data.data.status === "completed") {
            displayPdfResult(jobId, data.data);
            loadJobHistory();
          }
        })
        .catch(function (err) {
          clearInterval(pollInterval);
          hide(progress);
          processBtn.disabled = false;
          showError("pdf", err.message || "Failed to fetch results.");
        });
    }, 3000);
  }

  function displayPdfResult(jobId, data) {
    var result = $("#pdf-result");
    var iterationsEl = $("#pdf-iterations");
    var previewEl = $("#pdf-preview");
    var downloadBtn = $("#pdf-download-btn");

    iterationsEl.textContent = "Completed in " + (data.iterations || "N/A") + " iterations";

    // PDF preview
    previewEl.innerHTML = "";
    if (data.outputPdf) {
      var pdfBytes = atob(data.outputPdf);
      var arr = new Uint8Array(pdfBytes.length);
      for (var i = 0; i < pdfBytes.length; i++) {
        arr[i] = pdfBytes.charCodeAt(i);
      }
      var blob = new Blob([arr], { type: "application/pdf" });
      var url = URL.createObjectURL(blob);

      var iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.title = "PDF Preview";
      previewEl.appendChild(iframe);
    } else {
      previewEl.innerHTML = '<p style="padding:1rem;color:var(--color-text-secondary)">No PDF output was generated.</p>';
    }

    // Download button
    downloadBtn.onclick = function () {
      window.open(
        "/api/pdf-reconstruction/result/" + encodeURIComponent(jobId) + "?download=true",
        "_blank"
      );
    };

    show(result);

    // Load iteration gallery
    loadIterationGallery(jobId);
  }

  // ───── Iteration Gallery ─────

  function loadIterationGallery(jobId) {
    var gallery = $("#iteration-gallery");
    var timeline = $("#iteration-timeline");

    fetch("/api/pdf-reconstruction/result/" + encodeURIComponent(jobId) + "/iterations")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success || !data.data || data.data.count === 0) {
          hide(gallery);
          return;
        }

        timeline.innerHTML = "";

        data.data.iterations.forEach(function (iter) {
          var chip = document.createElement("button");
          chip.className = "iteration-chip";
          chip.type = "button";

          var sizeKB = (iter.sizeBytes / 1024).toFixed(0);
          chip.innerHTML =
            'Iteration ' + iter.n +
            ' <span class="iteration-chip__size">(' + sizeKB + ' KB)</span>';

          chip.addEventListener("click", function () {
            // Toggle active state
            var chips = timeline.querySelectorAll(".iteration-chip");
            chips.forEach(function (c) { c.classList.remove("iteration-chip--active"); });
            chip.classList.add("iteration-chip--active");

            showIterationPreview(jobId, iter.n);
          });

          timeline.appendChild(chip);
        });

        show(gallery);
      })
      .catch(function () {
        hide(gallery);
      });
  }

  function showIterationPreview(jobId, n) {
    var previewContainer = $("#iteration-preview");
    var label = $("#iteration-preview-label");
    var frame = $("#iteration-preview-frame");

    label.textContent = "Iteration " + n;
    frame.innerHTML = "";

    var iframe = document.createElement("iframe");
    iframe.src = "/api/pdf-reconstruction/result/" + encodeURIComponent(jobId) + "/iteration/" + n;
    iframe.title = "Iteration " + n + " Preview";
    frame.appendChild(iframe);

    show(previewContainer);
  }

  $("#iteration-close-btn").addEventListener("click", function () {
    hide($("#iteration-preview"));
    var chips = document.querySelectorAll(".iteration-chip");
    chips.forEach(function (c) { c.classList.remove("iteration-chip--active"); });
  });

  // ───── Video Analyzer ─────

  // Clustering method toggle — button switches between K-Means and DBSCAN
  var clusterToggleBtn = $("#video-cluster-toggle");
  var clustersField = $("#video-clusters-field");
  var epsField = $("#video-eps-field");
  var currentClusterMethod = "kmeans";

  function updateClusterFields() {
    if (currentClusterMethod === "kmeans") {
      clusterToggleBtn.textContent = "K-Means";
      show(clustersField);
      hide(epsField);
      $("#video-eps").value = "";
    } else {
      clusterToggleBtn.textContent = "DBSCAN";
      hide(clustersField);
      show(epsField);
      $("#video-clusters").value = "";
    }
  }

  clusterToggleBtn.addEventListener("click", function () {
    currentClusterMethod = currentClusterMethod === "kmeans" ? "dbscan" : "kmeans";
    updateClusterFields();
  });

  updateClusterFields();

  var videoDropzone = setupDropzone({
    dropzoneSelector: "#video-dropzone",
    fileInputSelector: "#video-file-input",
    browseBtnSelector: "#video-browse-btn",
    fileInfoSelector: "#video-file-info",
    fileNameSelector: "#video-file-name",
    fileRemoveSelector: "#video-file-remove",
    processBtnSelector: "#video-process-btn",
    validate: function (file) {
      var allowed = [
        "video/mp4", "video/avi", "video/quicktime", "video/x-msvideo",
        "video/x-matroska", "video/webm", "video/mpeg",
      ];
      if (allowed.indexOf(file.type) === -1) {
        showError("video", "Invalid file type. Please upload a video (MP4, AVI, MOV, MKV, WebM, or MPEG).");
        return false;
      }
      if (file.size > 500 * 1024 * 1024) {
        showError("video", "File is too large. Maximum size is 500 MB.");
        return false;
      }
      return true;
    },
  });

  $("#video-process-btn").addEventListener("click", function () {
    var file = videoDropzone.getFile();
    if (!file) return;
    startVideoJob(file);
  });

  function startVideoJob(file) {
    var processBtn = $("#video-process-btn");
    var progress = $("#video-progress");
    var result = $("#video-result");
    var error = $("#video-error");

    processBtn.disabled = true;
    hide(error);
    hide(result);
    show(progress);

    var formData = new FormData();
    formData.append("file", file);

    // Build query string from config
    var params = [];
    var clusters = $("#video-clusters").value;
    var eps = $("#video-eps").value;
    var lang = $("#video-lang").value;

    if (currentClusterMethod === "kmeans" && clusters) params.push("nClusters=" + encodeURIComponent(clusters));
    if (currentClusterMethod === "dbscan" && eps) params.push("dbscanEps=" + encodeURIComponent(eps));
    if (lang) params.push("lang=" + encodeURIComponent(lang));

    var qs = params.length > 0 ? "?" + params.join("&") : "";

    fetch("/api/video-analyzer/upload" + qs, {
      method: "POST",
      body: formData,
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.success) {
          throw new Error(data.error || "Upload failed");
        }
        pollVideoResult(data.data.jobId);
        loadJobHistory();
      })
      .catch(function (err) {
        hide(progress);
        processBtn.disabled = false;
        showError("video", err.message || "Failed to upload file.");
      });
  }

  function pollVideoResult(jobId) {
    var progress = $("#video-progress");
    var processBtn = $("#video-process-btn");

    show(progress);

    var pollInterval = setInterval(function () {
      fetch("/api/video-analyzer/result/" + encodeURIComponent(jobId))
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          if (!data.success && data.error) {
            clearInterval(pollInterval);
            hide(progress);
            processBtn.disabled = false;
            showError("video", data.error);
            loadJobHistory();
            return;
          }

          if (data.data && data.data.status === "processing") {
            return; // keep polling
          }

          clearInterval(pollInterval);
          hide(progress);
          processBtn.disabled = false;

          if (data.data && data.data.status === "completed") {
            displayVideoResult(jobId, data.data);
            loadJobHistory();
          }
        })
        .catch(function (err) {
          clearInterval(pollInterval);
          hide(progress);
          processBtn.disabled = false;
          showError("video", err.message || "Failed to fetch results.");
        });
    }, 4000);
  }

  // Distinct colors for up to 20 groups, then cycle
  var GROUP_COLORS = [
    "#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea",
    "#0891b2", "#e11d48", "#65a30d", "#c026d3", "#0d9488",
    "#ea580c", "#4f46e5", "#15803d", "#b91c1c", "#7c3aed",
    "#0284c7", "#db2777", "#ca8a04", "#059669", "#6d28d9",
  ];

  function getGroupColor(index) {
    return GROUP_COLORS[(index - 1) % GROUP_COLORS.length];
  }

  function renderTimeline(data) {
    var bar = $("#video-timeline-bar");
    var legend = $("#video-timeline-legend");
    bar.innerHTML = "";
    legend.innerHTML = "";

    if (!data.groups || data.groups.length === 0) return;

    // Check if any group has frameNumbers
    var hasFrameNumbers = data.groups.some(function (g) {
      return g.frameNumbers && g.frameNumbers.length > 0;
    });

    var runs = [];

    if (hasFrameNumbers) {
      // Build exact frame-level timeline from frameNumbers
      var maxFrame = 0;
      data.groups.forEach(function (group) {
        if (group.frameNumbers) {
          group.frameNumbers.forEach(function (n) {
            if (n > maxFrame) maxFrame = n;
          });
        }
      });

      if (maxFrame === 0) return;

      // Map frame number -> groupIndex
      var frameMap = {};
      data.groups.forEach(function (group) {
        if (group.frameNumbers) {
          group.frameNumbers.forEach(function (n) {
            frameMap[n] = group.groupIndex;
          });
        }
      });

      // Build runs of consecutive same-group frames
      var currentGroup = frameMap[1] !== undefined ? frameMap[1] : -1;
      var runStart = 1;

      for (var f = 2; f <= maxFrame; f++) {
        var g = frameMap[f] !== undefined ? frameMap[f] : -1;
        if (g !== currentGroup) {
          runs.push({ group: currentGroup, start: runStart, end: f - 1, total: maxFrame });
          currentGroup = g;
          runStart = f;
        }
      }
      runs.push({ group: currentGroup, start: runStart, end: maxFrame, total: maxFrame });
    } else {
      // Fallback: proportional segments from frameCount
      var totalFrames = data.totalFrames || 0;
      if (totalFrames === 0) {
        data.groups.forEach(function (g) { totalFrames += g.frameCount; });
      }
      if (totalFrames === 0) return;

      var offset = 0;
      data.groups.forEach(function (group) {
        runs.push({
          group: group.groupIndex,
          start: offset + 1,
          end: offset + group.frameCount,
          total: totalFrames,
        });
        offset += group.frameCount;
      });
    }

    // Render segments
    runs.forEach(function (run) {
      var segment = document.createElement("div");
      segment.className = "timeline__segment";
      var widthPct = ((run.end - run.start + 1) / run.total) * 100;
      segment.style.width = widthPct + "%";

      if (run.group === -1) {
        segment.style.background = "#e2e8f0";
      } else {
        segment.style.background = getGroupColor(run.group);
      }

      var tooltip = document.createElement("span");
      tooltip.className = "timeline__segment-tooltip";
      tooltip.textContent = run.group === -1
        ? "Unassigned (frames " + run.start + "-" + run.end + ")"
        : "Group " + run.group + " (frames " + run.start + "-" + run.end + ")";
      segment.appendChild(tooltip);

      bar.appendChild(segment);
    });

    // Render legend
    data.groups.forEach(function (group) {
      var item = document.createElement("div");
      item.className = "timeline__legend-item";

      var swatch = document.createElement("div");
      swatch.className = "timeline__legend-swatch";
      swatch.style.background = getGroupColor(group.groupIndex);

      var label = document.createElement("span");
      label.textContent = "Group " + group.groupIndex + " (" + group.frameCount + ")";

      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });
  }

  function displayVideoResult(jobId, data) {
    var result = $("#video-result");
    var meta = $("#video-meta");
    var grid = $("#video-frame-grid");

    meta.textContent =
      data.totalFrames + " total frames analyzed at " +
      (data.fps ? data.fps.toFixed(1) : "N/A") + " FPS -- " +
      data.groups.length + " unique groups found";

    // Render timeline
    renderTimeline(data);

    grid.innerHTML = "";

    data.groups.forEach(function (group) {
      var card = document.createElement("div");
      card.className = "frame-card";

      // Color indicator bar at top of card
      var colorBar = document.createElement("div");
      colorBar.style.height = "4px";
      colorBar.style.background = getGroupColor(group.groupIndex);

      var img = document.createElement("img");
      img.className = "frame-card__img";
      img.alt = "Group " + group.groupIndex;
      if (group.representativeImage) {
        img.src = "data:image/png;base64," + group.representativeImage;
      } else {
        img.src = "/api/video-analyzer/result/" + encodeURIComponent(jobId) + "/frame/" + group.groupIndex;
      }

      var info = document.createElement("div");
      info.className = "frame-card__info";

      var label = document.createElement("div");
      label.className = "frame-card__label";
      label.textContent = "Group " + group.groupIndex;

      var detail = document.createElement("div");
      detail.className = "frame-card__detail";
      detail.textContent =
        group.frameCount + " frames | " +
        (group.timeRange.start || "N/A") + " - " +
        (group.timeRange.end || "N/A");

      info.appendChild(label);
      info.appendChild(detail);
      card.appendChild(colorBar);
      card.appendChild(img);
      card.appendChild(info);
      grid.appendChild(card);
    });

    show(result);
  }

  // ───── Error Display ─────

  function showError(section, message) {
    var el = $("#" + section + "-error");
    el.textContent = message;
    show(el);
  }
})();
