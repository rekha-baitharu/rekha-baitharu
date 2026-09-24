/**
 * Tisso Vision Gift Guide - Modular Vanilla JavaScript
 * Handles Hotspot interactions, dynamic variant modal rendering,
 * AJAX cart integration, and automatic add-on business rules.
 */

class TissoGiftGuide {
  constructor(sectionElement) {
    this.section = sectionElement;
    this.sectionId = this.section.dataset.sectionId || 'tisso';
    this.activeHotspot = null;
    this.selectedProduct = null;
    this.currentProduct = null;
    this.selectedOptions = [];
    this.selectedVariant = null;
    this.autoCloseTimer = null;

    // Attach reference to DOM element
    this.section._tissoInstance = this;

    // Read add-on configuration from section dataset
    this.addonEnabled = this.section.dataset.addonEnabled === 'true';
    this.addonProductData = this.getAddonProductData();
    this.qualifyingColor = (this.section.dataset.qualifyingColor || 'black').trim().toLowerCase();
    this.qualifyingSize = (this.section.dataset.qualifyingSize || 'medium').trim().toLowerCase();

    this.init();
  }

  init() {
    this.bindHotspots();
    this.bindModalEvents();
  }

  getModalBackdrop() {
    return (
      document.getElementById(`TissoModal-${this.sectionId}`) ||
      this.section.querySelector('.tisso-modal-backdrop') ||
      document.querySelector('.tisso-modal-backdrop')
    );
  }

  getModal() {
    const backdrop = this.getModalBackdrop();
    return backdrop ? backdrop.querySelector('.tisso-modal') : null;
  }

  getAddonProductData() {
    const addonScript =
      document.getElementById(`tisso-addon-data-${this.sectionId}`) ||
      this.section.querySelector('.tisso-addon-json') ||
      document.querySelector('.tisso-addon-json');

    if (addonScript) {
      const rawText = (addonScript.textContent || '').trim();
      if (rawText && rawText !== 'null') {
        try {
          const rawData = JSON.parse(rawText);
          return this.normalizeProductData(rawData);
        } catch (e) {
          console.error('[Tisso Gift Guide] Failed to parse addon product data:', e);
        }
      }
    }
    return null;
  }

  /**
   * Universal Product Normalizer
   * Strictly normalizes the Shopify product object configured on the block.
   */
  normalizeProductData(product) {
    if (!product || typeof product !== 'object' || (!product.title && !product.id)) {
      return null;
    }

    const title = product.title || '';
    const price = typeof product.price === 'number' && product.price > 0 ? product.price : (product.variants && product.variants[0] ? product.variants[0].price : 0);
    const compare_at_price = product.compare_at_price || null;
    const available = product.available !== undefined ? Boolean(product.available) : true;
    const description = product.description || '';

    let featuredImage = '';
    if (typeof product.featured_image === 'string') {
      featuredImage = product.featured_image;
    } else if (product.featured_image && typeof product.featured_image.src === 'string') {
      featuredImage = product.featured_image.src;
    } else if (Array.isArray(product.images) && product.images.length > 0) {
      featuredImage = typeof product.images[0] === 'string' ? product.images[0] : product.images[0]?.src || '';
    }

    if (featuredImage && featuredImage.startsWith('//')) {
      featuredImage = 'https:' + featuredImage;
    }

    const rawVariants = Array.isArray(product.variants) ? product.variants : [];

    const normVariants = rawVariants.map((v, vIdx) => {
      let variantOptions = [];
      if (Array.isArray(v.options) && v.options.length > 0) {
        variantOptions = v.options;
      } else {
        if (v.option1 !== undefined && v.option1 !== null) variantOptions.push(v.option1);
        if (v.option2 !== undefined && v.option2 !== null) variantOptions.push(v.option2);
        if (v.option3 !== undefined && v.option3 !== null) variantOptions.push(v.option3);
      }
      if (variantOptions.length === 0) {
        variantOptions = [v.title || `Default Title`];
      }

      let variantImage = null;
      let vSrc = typeof v.featured_image === 'string' ? v.featured_image : v.featured_image?.src || '';
      if (vSrc && vSrc.startsWith('//')) vSrc = 'https:' + vSrc;
      if (vSrc) variantImage = { src: vSrc };

      return {
        id: v.id,
        title: v.title || variantOptions.join(' / '),
        price: typeof v.price === 'number' && v.price > 0 ? v.price : price,
        compare_at_price: v.compare_at_price || null,
        available: v.available !== undefined ? Boolean(v.available) : true,
        options: variantOptions,
        featured_image: variantImage,
      };
    });

    let normOptions = [];
    if (
      Array.isArray(product.options) &&
      product.options.length > 0 &&
      typeof product.options[0] === 'object' &&
      Array.isArray(product.options[0].values) &&
      product.options[0].values.length > 0
    ) {
      normOptions = product.options.map((opt, idx) => ({
        name: opt.name || `Option ${idx + 1}`,
        position: opt.position || idx + 1,
        values: opt.values,
      }));
    } else if (Array.isArray(product.options) && product.options.length > 0) {
      normOptions = product.options.map((opt, idx) => {
        const optName = typeof opt === 'string' ? opt : opt.name || `Option ${idx + 1}`;
        const values = [];
        normVariants.forEach((v) => {
          const val = v.options && v.options[idx] !== undefined ? v.options[idx] : null;
          if (val !== null && val !== undefined && !values.includes(val)) {
            values.push(val);
          }
        });
        return {
          name: optName,
          position: idx + 1,
          values: values.length > 0 ? values : ['Default'],
        };
      });
    }

    return {
      id: product.id,
      handle: product.handle || '',
      title,
      price,
      compare_at_price,
      available,
      description,
      featured_image: featuredImage,
      options: normOptions,
      variants: normVariants,
    };
  }

  /**
   * Event Delegation: Listen on section container for all hotspot (+) button clicks.
   */
  bindHotspots() {
    if (this.section.dataset.hotspotsBound === 'true') return;
    this.section.dataset.hotspotsBound = 'true';

    this.section.addEventListener('click', (evt) => {
      const btn = evt.target.closest('.tisso-hotspot-btn');
      if (!btn || !this.section.contains(btn)) return;

      evt.preventDefault();
      evt.stopPropagation();
      this.handleHotspotClick(btn);
    });
  }

  /**
   * Event Delegation on Modal Backdrop for close, click-outside, and Add-To-Cart actions.
   */
  bindModalEvents() {
    const backdrop = this.getModalBackdrop();
    if (!backdrop || backdrop.dataset.modalBound === 'true') return;
    backdrop.dataset.modalBound = 'true';

    // 1. Close on backdrop click (outside modal content)
    backdrop.addEventListener('click', (evt) => {
      if (evt.target === backdrop) {
        this.closeModal();
      }
    });

    // 2. Close on close button click (delegated)
    backdrop.addEventListener('click', (evt) => {
      if (evt.target.closest('.tisso-modal__close-btn')) {
        evt.preventDefault();
        this.closeModal();
      }
    });

    // 3. Add To Cart button click (delegated)
    backdrop.addEventListener('click', (evt) => {
      const addBtn = evt.target.closest('.tisso-btn--modal-add');
      if (!addBtn) return;
      if (addBtn.disabled || addBtn.getAttribute('aria-disabled') === 'true') return;

      evt.preventDefault();
      this.handleAddToCart();
    });

    // 4. Keyboard navigation: ESC to close & focus trapping
    document.addEventListener('keydown', (evt) => {
      if (!this.isModalOpen()) return;

      if (evt.key === 'Escape' || evt.key === 'Esc') {
        evt.preventDefault();
        this.closeModal();
        return;
      }

      if (evt.key === 'Tab') {
        this.handleFocusTrap(evt);
      }
    });
  }

  async handleHotspotClick(button) {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    this.activeHotspot = button;
    const blockId = button.dataset.blockId;
    let productHandle = button.dataset.productHandle;

    let rawProductData = null;

    // 1. Read product directly from the clicked hotspot's data-product attribute
    if (button.dataset && button.dataset.product) {
      try {
        const parsed = JSON.parse(button.dataset.product);
        if (typeof parsed === 'object' && parsed !== null && parsed.title) {
          rawProductData = parsed;
        } else if (typeof parsed === 'string' && parsed.trim()) {
          productHandle = parsed.trim();
        }
      } catch (e) {
        if (typeof button.dataset.product === 'string' && button.dataset.product.trim()) {
          productHandle = button.dataset.product.trim();
        }
      }
    }

    // 2. Read from block's JSON script tag if full product object was not in data-product
    if (!rawProductData && blockId) {
      const scriptEl =
        document.getElementById(`tisso-product-data-${blockId}`) ||
        button.closest('.tisso-product-card')?.querySelector('.tisso-product-json') ||
        button.closest('.tisso-product-card')?.querySelector('script[type="application/json"]');

      if (scriptEl) {
        const rawText = (scriptEl.textContent || '').trim();
        if (rawText && rawText !== 'null') {
          try {
            const parsed = JSON.parse(rawText);
            if (typeof parsed === 'object' && parsed !== null && parsed.title) {
              rawProductData = parsed;
            } else if (typeof parsed === 'string' && parsed.trim()) {
              productHandle = parsed.trim();
            }
          } catch (err) {
            console.error('[Tisso Gift Guide] Error parsing product JSON:', err);
          }
        }
      }
    }

    // 3. Fetch the exact product using the handle if full product object is not yet loaded
    if (!rawProductData && productHandle) {
      if (!this.productCache) this.productCache = {};

      if (this.productCache[productHandle]) {
        rawProductData = this.productCache[productHandle];
      } else {
        try {
          const response = await fetch(`/products/${encodeURIComponent(productHandle)}.js`);
          if (response.ok) {
            rawProductData = await response.json();
            this.productCache[productHandle] = rawProductData;
          } else {
            console.error('[Gift Guide] Product could not be loaded:', productHandle, response.status);
          }
        } catch (e) {
          console.error('[Gift Guide] Error fetching product by handle:', e);
        }
      }
    }

    if (!rawProductData) {
      if (!productHandle) {
        console.error('[Gift Guide] No product handle found for block:', blockId);
      }
      return;
    }

    // 4. Normalize the product belonging strictly to this block
    const product = this.normalizeProductData(rawProductData);

    if (!product) {
      console.error('[Gift Guide] Unable to normalize product for handle:', productHandle);
      return;
    }

    console.log('[Gift Guide] Block ID:', blockId);
    console.log('[Gift Guide] Product handle:', productHandle || product.handle);
    console.log('[Gift Guide] Product ID:', product.id);
    console.log('[Gift Guide] Product title:', product.title);
    console.log('[Gift Guide] Popup product:', product.title);

    this.selectedProduct = product;
    this.currentProduct = product;

    // 5. Render and open modal
    this.renderProductModal(product);
    this.openModal();
  }

  isModalOpen() {
    const backdrop = this.getModalBackdrop();
    return Boolean(backdrop && backdrop.classList.contains('is-active'));
  }

  openModal() {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    const backdrop = this.getModalBackdrop();
    if (!backdrop) return;

    this.clearMessages();
    backdrop.classList.add('is-active');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tisso-modal-open');

    // Accessibility: Focus close button
    setTimeout(() => {
      const closeBtn = backdrop.querySelector('.tisso-modal__close-btn');
      if (closeBtn) {
        closeBtn.focus();
      }
    }, 100);
  }

  closeModal() {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    const backdrop = this.getModalBackdrop();
    if (!backdrop) return;

    backdrop.classList.remove('is-active');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('tisso-modal-open');

    // Ensure loading state is reset when modal closes
    const modal = this.getModal();
    if (modal) {
      const addBtn = modal.querySelector('.tisso-btn--modal-add');
      this.setButtonLoading(addBtn, false);
    }

    // Restore focus to hotspot button
    if (
      this.activeHotspot &&
      document.body.contains(this.activeHotspot) &&
      typeof this.activeHotspot.focus === 'function'
    ) {
      this.activeHotspot.focus();
    }
  }

  handleFocusTrap(evt) {
    const modal = this.getModal();
    if (!modal) return;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusableElements.length) return;

    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];

    if (evt.shiftKey && document.activeElement === firstEl) {
      evt.preventDefault();
      lastEl.focus();
    } else if (!evt.shiftKey && document.activeElement === lastEl) {
      evt.preventDefault();
      firstEl.focus();
    }
  }

  renderProductModal(product) {
    if (!product) return;

    // Determine initial variant (first available or first variant)
    let initialVariant =
      (product.variants && product.variants.find((v) => v.available)) ||
      (product.variants && product.variants[0]) ||
      null;
    this.selectedVariant = initialVariant;
    this.selectedOptions = initialVariant && Array.isArray(initialVariant.options) ? [...initialVariant.options] : [];

    // Ensure selectedOptions contains defaults for all options
    if (Array.isArray(product.options)) {
      product.options.forEach((opt, idx) => {
        if (!this.selectedOptions[idx] && opt.values && opt.values.length > 0) {
          this.selectedOptions[idx] = opt.values[0];
        }
      });
    }

    const modal = this.getModal();
    if (!modal) return;

    // 1. Thumbnail Image
    const thumbImg = modal.querySelector('.tisso-modal__thumbnail-img');
    const imageSrc =
      initialVariant && initialVariant.featured_image && initialVariant.featured_image.src
        ? initialVariant.featured_image.src
        : product.featured_image || '';

    if (thumbImg) {
      thumbImg.src = imageSrc;
      thumbImg.alt = product.title || '';
    }

    // 2. Title
    const titleEl = modal.querySelector('.tisso-modal__title');
    if (titleEl) {
      titleEl.textContent = product.title || '';
    }

    // 3. Price
    this.updatePriceDisplay(initialVariant, product);

    // 4. Description
    const descEl = modal.querySelector('.tisso-modal__description');
    if (descEl) {
      descEl.innerHTML = this.sanitizeDescription(product.description || '');
    }

    // 5. Dynamic Option Selectors
    this.renderOptions(product);

    // 6. Update Button State
    this.updateAddToCartState();
  }

  sanitizeDescription(html) {
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    temp.querySelectorAll('script, style, iframe, frame, object, embed').forEach((n) => n.remove());
    return temp.textContent || temp.innerText || '';
  }

  formatMoney(cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return '0,00€';
    const num = Number(cents) / 100;
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '€';
  }

  updatePriceDisplay(variant, product) {
    const modal = this.getModal();
    if (!modal) return;

    const priceEl = modal.querySelector('.tisso-modal__price');
    const comparePriceEl = modal.querySelector('.tisso-modal__compare-price');

    if (!priceEl) return;

    const priceValue = variant && variant.price ? variant.price : product && product.price ? product.price : 0;
    priceEl.textContent = this.formatMoney(priceValue);

    if (variant && variant.compare_at_price && variant.compare_at_price > variant.price) {
      comparePriceEl.textContent = this.formatMoney(variant.compare_at_price);
      comparePriceEl.style.display = 'inline';
    } else {
      comparePriceEl.textContent = '';
      comparePriceEl.style.display = 'none';
    }
  }

  renderOptions(product) {
    const modal = this.getModal();
    if (!modal) return;

    const optionsContainer = modal.querySelector('.tisso-modal__options');
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';

    if (!product.options || product.options.length === 0) {
      return;
    }

    // Preserve original index for variant mapping, but enforce UI display order: Color -> Size -> Others
    const optionsWithIndex = product.options.map((option, originalIndex) => ({
      option,
      originalIndex,
    }));

    const colorOptions = optionsWithIndex.filter(({ option }) => {
      const name = (option.name || '').toLowerCase();
      return name.includes('color') || name.includes('colour');
    });

    const sizeOptions = optionsWithIndex.filter(({ option }) => {
      const name = (option.name || '').toLowerCase();
      return name.includes('size');
    });

    const otherOptions = optionsWithIndex.filter(({ option }) => {
      const name = (option.name || '').toLowerCase();
      return !name.includes('color') && !name.includes('colour') && !name.includes('size');
    });

    const orderedOptionsWithIndex = [...colorOptions, ...sizeOptions, ...otherOptions];

    orderedOptionsWithIndex.forEach(({ option, originalIndex }) => {
      const optionValues = Array.isArray(option.values) ? option.values : [];
      if (optionValues.length === 0) return;

      // Skip single default title option (simple products without variants)
      if (option.name === 'Title' && optionValues.length === 1 && optionValues[0] === 'Default Title') {
        return;
      }

      const group = document.createElement('div');
      group.className = 'tisso-option-group';

      const label = document.createElement('span');
      label.className = 'tisso-option-label';
      label.textContent = option.name || `Option ${originalIndex + 1}`;
      group.appendChild(label);

      const optionNameLower = (option.name || '').toLowerCase();

      // If option is Color or has few values (pills layout)
      if (
        optionNameLower.includes('color') ||
        optionNameLower.includes('colour') ||
        (optionValues.length <= 4 && !optionNameLower.includes('size'))
      ) {
        const pillsList = document.createElement('div');
        pillsList.className = 'tisso-pills-list';
        pillsList.setAttribute('role', 'radiogroup');
        pillsList.setAttribute('aria-label', option.name || 'Color');

        optionValues.forEach((val, valIndex) => {
          const pillItem = document.createElement('div');
          pillItem.className = 'tisso-pill-item';

          const inputId = `tisso-opt-${this.sectionId}-${originalIndex}-${valIndex}`;
          const isChecked = (this.selectedOptions[originalIndex] || optionValues[0]) === val;

          pillItem.innerHTML = `
            <input type="radio" 
                   id="${inputId}" 
                   name="tisso-option-${this.sectionId}-${originalIndex}" 
                   value="${this.escapeHtml(val)}" 
                   class="tisso-pill-input" 
                   ${isChecked ? 'checked' : ''}>
            <label for="${inputId}" class="tisso-pill-label">${this.escapeHtml(val)}</label>
          `;

          const radioInput = pillItem.querySelector('input');
          radioInput.addEventListener('change', () => {
            this.handleOptionChange(originalIndex, val);
          });

          pillsList.appendChild(pillItem);
        });

        group.appendChild(pillsList);
      } else {
        // Dropdown layout (e.g. Size or options with multiple values)
        const selectWrapper = document.createElement('div');
        selectWrapper.className = 'tisso-select-wrapper';

        const select = document.createElement('select');
        select.className = 'tisso-select';
        select.setAttribute('aria-label', option.name || 'Option');

        optionValues.forEach((val) => {
          const optionEl = document.createElement('option');
          optionEl.value = val;
          optionEl.textContent = val;
          if (this.selectedOptions[originalIndex] === val) {
            optionEl.selected = true;
          }
          select.appendChild(optionEl);
        });

        select.addEventListener('change', (evt) => {
          this.handleOptionChange(originalIndex, evt.target.value);
        });

        const chevronWrap = document.createElement('div');
        chevronWrap.className = 'tisso-select-chevron-wrap';
        chevronWrap.innerHTML = `
          <svg width="14" height="8" viewBox="0 0 14 8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L7 7L13 1" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;

        selectWrapper.appendChild(select);
        selectWrapper.appendChild(chevronWrap);
        group.appendChild(selectWrapper);
      }

      optionsContainer.appendChild(group);
    });
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  handleOptionChange(optionIndex, newValue) {
    this.selectedOptions[optionIndex] = newValue;
    this.clearMessages();

    // 1. Match variant based on selected options
    let matchedVariant = this.selectedProduct.variants.find((variant) => {
      return (variant.options || []).every((val, idx) => {
        return this.selectedOptions[idx] === undefined || this.selectedOptions[idx] === val;
      });
    });

    // 2. Fallback: match first available variant matching this new option
    if (!matchedVariant) {
      matchedVariant = this.selectedProduct.variants.find((variant) => {
        return variant.options && variant.options[optionIndex] === newValue;
      });
    }

    this.selectedVariant = matchedVariant || null;

    // Update thumbnail if variant has its own image
    const modal = this.getModal();
    if (modal) {
      const thumbImg = modal.querySelector('.tisso-modal__thumbnail-img');
      if (thumbImg) {
        if (this.selectedVariant && this.selectedVariant.featured_image && this.selectedVariant.featured_image.src) {
          thumbImg.src = this.selectedVariant.featured_image.src;
        } else if (this.selectedProduct && this.selectedProduct.featured_image) {
          thumbImg.src = this.selectedProduct.featured_image;
        }
      }
    }

    // Update Price
    this.updatePriceDisplay(this.selectedVariant, this.selectedProduct);

    // Update Add to Cart Button state
    this.updateAddToCartState();
  }

  updateAddToCartState() {
    const modal = this.getModal();
    if (!modal) return;

    const addBtn = modal.querySelector('.tisso-btn--modal-add');
    const btnText = addBtn ? addBtn.querySelector('.tisso-btn-text') : null;
    if (!addBtn || !btnText) return;

    this.setButtonLoading(addBtn, false);

    if (!this.selectedVariant || !this.selectedVariant.available) {
      addBtn.disabled = true;
      addBtn.setAttribute('aria-disabled', 'true');
      btnText.textContent = !this.selectedVariant ? 'UNAVAILABLE' : (window.variantStrings?.soldOut || 'SOLD OUT');
    } else {
      addBtn.disabled = false;
      addBtn.setAttribute('aria-disabled', 'false');
      btnText.textContent = window.variantStrings?.addToCart || 'ADD TO CART';
    }
  }



  checkQualifyingAddonCondition() {
    if (!this.selectedVariant || !this.selectedProduct) {
      return false;
    }

    const normalize = (value) => String(value || '').trim().toLowerCase();

    // Determine Option Indices Dynamically (Color and Size)
    let selectedColor = '';
    let selectedSize = '';

    if (Array.isArray(this.selectedProduct.options)) {
      this.selectedProduct.options.forEach((opt, idx) => {
        const optName = normalize(opt.name);
        const val = normalize(
          (this.selectedVariant.options && this.selectedVariant.options[idx]) !== undefined
            ? this.selectedVariant.options[idx]
            : this.selectedOptions[idx]
        );

        if (optName.includes('color') || optName.includes('colour')) {
          selectedColor = val;
        }

        if (optName.includes('size')) {
          selectedSize = val;
        }
      });
    }

    // Normalize & Check Values
    const isBlack = selectedColor === 'black';
    const isMedium = selectedSize === 'medium' || selectedSize === 'm';

    const qualifies = isBlack && isMedium;

    // Debug Logging as requested
    console.log('[Gift Guide Freebie] Selected color:', selectedColor);
    console.log('[Gift Guide Freebie] Selected size:', selectedSize);
    console.log('[Gift Guide Freebie] Product ID:', this.selectedProduct.id);
    console.log('[Gift Guide Freebie] Variant ID:', this.selectedVariant.id);
    console.log('[Gift Guide Freebie] Qualifying Black/Medium product:', qualifies);

    return qualifies;
  }

  async handleAddToCart() {
    const targetProduct = this.selectedProduct || this.currentProduct;
    if (!targetProduct) {
      this.showErrorMessage('No product selected for this block.');
      return;
    }

    const targetVariant = this.selectedVariant || (targetProduct.variants && targetProduct.variants[0]);
    if (!targetVariant) {
      this.showErrorMessage('Please select a valid product variant.');
      return;
    }

    if (!targetVariant.available) {
      this.showErrorMessage('Selected product is currently unavailable.');
      return;
    }

    const modal = this.getModal();
    const addBtn = modal ? modal.querySelector('.tisso-btn--modal-add') : null;
    this.setButtonLoading(addBtn, true);
    this.clearMessages();

    const variantId = targetVariant.id;
    const itemsToAdd = [
      {
        id: variantId,
        quantity: 1,
      },
    ];

    try {
      const qualifiesForFreebie = this.checkQualifyingAddonCondition();

      if (qualifiesForFreebie) {
        const freebieResolution = await resolveSoftWinterJacketVariantId();
        if (freebieResolution && freebieResolution.variantId) {
          try {
            const cartRes = await fetch(`${window.routes?.cart_url || '/cart'}.js`);
            if (cartRes.ok) {
              const cartData = await cartRes.json();
              const hasFreebieInCart = (cartData.items || []).some(
                (item) =>
                  String(item.product_id) === SOFT_WINTER_JACKET_PRODUCT_ID ||
                  item.id === freebieResolution.variantId
              );

              if (!hasFreebieInCart) {
                itemsToAdd.push({
                  id: freebieResolution.variantId,
                  quantity: 1,
                });
                console.log('[Gift Guide Freebie] Adding Soft Winter Jacket');
                console.log('[Gift Guide Freebie] Product ID:', freebieResolution.productId);
                console.log('[Gift Guide Freebie] Product title:', freebieResolution.productTitle);
                console.log('[Gift Guide Freebie] Variant ID:', freebieResolution.variantId);
                console.log('[Gift Guide Freebie] Variant title:', freebieResolution.variantTitle);
              }
            }
          } catch (e) {
            console.warn('[Gift Guide Freebie] Cart check warning:', e);
          }
        } else {
          console.error('[Gift Guide Freebie] ERROR: Could not resolve Soft Winter Jacket variant');
        }
      }

      // Execute Cart Addition via AJAX
      await this.submitCartItems(itemsToAdd);

      // Trigger freebie sync to verify state
      await syncBlackMediumFreebie();

      // Redirect user directly to the Shopify Cart page
      window.location.href = window.routes?.cart_url || '/cart';
    } catch (error) {
      console.error('[Tisso Gift Guide] Cart add error:', error);
      this.setButtonLoading(addBtn, false);
      this.showErrorMessage(error.message || 'Unable to add this product to cart. Please try again.');
    }
  }

  async submitCartItems(items) {
    const payload = {
      items: items,
    };

    const addUrl = window.routes?.cart_add_url || '/cart/add.js';
    const response = await fetch(addUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || (data.status && Number(data.status) >= 400)) {
      throw new Error(data.description || data.message || 'Error adding item to cart');
    }

    return data;
  }

  setButtonLoading(button, isLoading) {
    if (!button) return;
    const btnText = button.querySelector('.tisso-btn-text');
    if (isLoading) {
      button.classList.add('is-loading');
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      if (btnText) btnText.textContent = 'ADDING...';
    } else {
      button.classList.remove('is-loading');
      button.disabled = false;
      button.setAttribute('aria-disabled', 'false');
      if (btnText) btnText.textContent = 'ADD TO CART';
    }
  }

  showErrorMessage(msg) {
    const modal = this.getModal();
    if (!modal) return;
    const msgEl = modal.querySelector('.tisso-modal__message');
    if (msgEl) {
      msgEl.className = 'tisso-modal__message is-error';
      msgEl.textContent = msg;
      msgEl.style.display = 'block';
    }
  }

  showSuccessMessage(msg) {
    const modal = this.getModal();
    if (!modal) return;
    const msgEl = modal.querySelector('.tisso-modal__message');
    if (msgEl) {
      msgEl.className = 'tisso-modal__message is-success';
      msgEl.textContent = msg;
      msgEl.style.display = 'block';
    }
  }

  clearMessages() {
    const modal = this.getModal();
    if (!modal) return;
    const msgEl = modal.querySelector('.tisso-modal__message');
    if (msgEl) {
      msgEl.className = 'tisso-modal__message';
      msgEl.textContent = '';
      msgEl.style.display = 'none';
    }
  }
}

// ---------------------------------------------------------
// Global Freebie Synchronization Module (Soft Winter Jacket)
// ---------------------------------------------------------

const SOFT_WINTER_JACKET_PRODUCT_ID = '10221714276455';
let cachedSoftWinterJacketResolution = null;
window._tissoSyncing = false;

async function resolveSoftWinterJacketVariantId() {
  if (cachedSoftWinterJacketResolution && cachedSoftWinterJacketResolution.variantId) {
    return cachedSoftWinterJacketResolution;
  }

  let resolvedProduct = null;

  // 1. Check window._tissoFreebieData provided by Liquid
  if (window._tissoFreebieData && window._tissoFreebieData.product) {
    const p = window._tissoFreebieData.product;
    if (
      String(p.id) === SOFT_WINTER_JACKET_PRODUCT_ID ||
      (p.title && p.title.toLowerCase().includes('soft winter jacket'))
    ) {
      resolvedProduct = p;
    }
  }

  // 2. Check embedded Liquid JSON in DOM (.tisso-addon-json)
  if (!resolvedProduct) {
    const addonScript =
      document.querySelector('.tisso-addon-json') ||
      document.querySelector('[id^="tisso-addon-data-"]');

    if (addonScript) {
      try {
        const rawText = (addonScript.textContent || '').trim();
        if (rawText && rawText !== 'null') {
          const data = JSON.parse(rawText);
          if (
            data &&
            (String(data.id) === SOFT_WINTER_JACKET_PRODUCT_ID ||
              (data.title && data.title.toLowerCase().includes('soft winter jacket'))) &&
            data.variants &&
            data.variants.length > 0 &&
            data.id !== 99999 &&
            !String(data.id).startsWith('9999')
          ) {
            resolvedProduct = data;
          }
        }
      } catch (e) {}
    }
  }

  // 3. Fallback: Search Shopify Storefront for product ID 10221714276455 or "Soft Winter Jacket"
  if (!resolvedProduct) {
    try {
      const searchQueries = [
        `/search/suggest.json?q=10221714276455&resources[type]=product`,
        `/search/suggest.json?q=Soft+Winter+Jacket&resources[type]=product`,
      ];

      for (const url of searchQueries) {
        if (resolvedProduct) break;
        const searchRes = await fetch(url);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const products = searchData?.resources?.results?.products || [];
          const match = products.find(
            (p) =>
              String(p.id) === SOFT_WINTER_JACKET_PRODUCT_ID ||
              (p.title && p.title.toLowerCase().includes('soft winter jacket'))
          );

          if (match && match.handle) {
            const productRes = await fetch(`/products/${encodeURIComponent(match.handle)}.js`);
            if (productRes.ok) {
              resolvedProduct = await productRes.json();
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Gift Guide Freebie] Search lookup warning:', e);
    }
  }

  if (
    !resolvedProduct ||
    !Array.isArray(resolvedProduct.variants) ||
    resolvedProduct.variants.length === 0
  ) {
    console.error('[Gift Guide Freebie] ERROR: Could not resolve Soft Winter Jacket variant');
    return null;
  }

  const availableVariant =
    resolvedProduct.variants.find((v) => v.available) || resolvedProduct.variants[0];

  if (!availableVariant || !availableVariant.id) {
    console.error('[Gift Guide Freebie] ERROR: Could not resolve Soft Winter Jacket variant');
    return null;
  }

  const result = {
    productId: String(resolvedProduct.id || SOFT_WINTER_JACKET_PRODUCT_ID),
    productTitle: resolvedProduct.title || 'Soft Winter Jacket',
    variantId: availableVariant.id,
    variantTitle: availableVariant.title || 'Default Title',
  };

  cachedSoftWinterJacketResolution = result;

  console.log('[Gift Guide Freebie] Soft Winter Jacket product ID:', result.productId);
  console.log('[Gift Guide Freebie] Soft Winter Jacket title:', result.productTitle);
  console.log('[Gift Guide Freebie] Soft Winter Jacket variant ID:', result.variantId);
  console.log('[Gift Guide Freebie] Soft Winter Jacket variant title:', result.variantTitle);

  return result;
}

function isItemBlackMedium(item) {
  if (!item || item.quantity <= 0) return false;
  if (
    String(item.product_id) === SOFT_WINTER_JACKET_PRODUCT_ID ||
    item.handle === 'soft-winter-jacket'
  ) {
    return false;
  }

  const normalize = (value) => String(value || '').trim().toLowerCase();

  let itemColor = '';
  let itemSize = '';

  // 1. Check options_with_values (most accurate representation in Shopify cart API)
  if (Array.isArray(item.options_with_values) && item.options_with_values.length > 0) {
    item.options_with_values.forEach((opt) => {
      const name = normalize(opt.name);
      const val = normalize(opt.value);
      if (name.includes('color') || name.includes('colour')) {
        itemColor = val;
      }
      if (name.includes('size')) {
        itemSize = val;
      }
    });
  }

  // 2. Check variant_options if options_with_values didn't yield both
  if ((!itemColor || !itemSize) && Array.isArray(item.variant_options) && item.variant_options.length > 0) {
    item.variant_options.forEach((val) => {
      const normVal = normalize(val);
      if (normVal === 'black' || normVal === 'white' || normVal === 'blue' || normVal === 'red' || normVal === 'green' || normVal === 'brown') {
        if (!itemColor) itemColor = normVal;
      }
      if (normVal === 'medium' || normVal === 'm' || normVal === 'small' || normVal === 's' || normVal === 'large' || normVal === 'l' || normVal === 'xs' || normVal === 'xl') {
        if (!itemSize) itemSize = normVal;
      }
    });
  }

  // 3. Check variant_title (e.g. "Black / Medium", "White / Medium", "Black / M")
  if ((!itemColor || !itemSize) && item.variant_title && item.variant_title !== 'Default Title') {
    const parts = item.variant_title.split('/').map((s) => normalize(s));
    parts.forEach((part) => {
      if (part === 'black' || part === 'white' || part === 'blue' || part === 'red' || part === 'green' || part === 'brown') {
        if (!itemColor) itemColor = part;
      }
      if (part === 'medium' || part === 'm' || part === 'small' || part === 's' || part === 'large' || part === 'l' || part === 'xs' || part === 'xl') {
        if (!itemSize) itemSize = part;
      }
    });
  }

  const isBlack = itemColor === 'black';
  const isMedium = itemSize === 'medium' || itemSize === 'm';

  return isBlack && isMedium;
}

function refreshCartUI() {
  if (typeof window.publish === 'function' && window.PUB_SUB_EVENTS?.cartUpdate) {
    window.publish(window.PUB_SUB_EVENTS.cartUpdate, { source: 'tisso-freebie-sync' });
  }

  const cartElements = document.querySelectorAll('cart-items, cart-drawer-items');
  cartElements.forEach((el) => {
    if (typeof el.onCartUpdate === 'function') {
      el.onCartUpdate();
    }
  });

  // If on /cart page without active cart-items component or after mutation
  if (
    (window.location.pathname.endsWith('/cart') || window.location.pathname.endsWith('/cart/')) &&
    !document.querySelector('cart-items')
  ) {
    window.location.reload();
  }
}

async function syncBlackMediumFreebie(cartData) {
  if (window._tissoSyncing) return;

  try {
    let cart = cartData;
    if (!cart || !Array.isArray(cart.items)) {
      const response = await fetch(`${window.routes?.cart_url || '/cart'}.js`);
      if (!response.ok) return;
      cart = await response.json();
    }

    const items = cart.items || [];
    const qualifyingItems = items.filter(isItemBlackMedium);
    const hasQualifying = qualifyingItems.length > 0;

    const freebieItem = items.find(
      (item) =>
        String(item.product_id) === SOFT_WINTER_JACKET_PRODUCT_ID ||
        (cachedSoftWinterJacketResolution && item.id === cachedSoftWinterJacketResolution.variantId)
    );
    const hasFreebie = Boolean(freebieItem);

    console.log('[Gift Guide Freebie] Cart checked');
    console.log('[Gift Guide Freebie] Qualifying Black/Medium product:', hasQualifying);
    console.log('[Gift Guide Freebie] Soft Winter Jacket in cart:', hasFreebie);

    // Rule 1: Qualifying product exists AND Soft Winter Jacket NOT in cart -> ADD
    if (hasQualifying && !hasFreebie) {
      window._tissoSyncing = true;
      console.log('[Gift Guide Freebie] Adding Soft Winter Jacket');
      const freebieResolution = await resolveSoftWinterJacketVariantId();

      if (!freebieResolution || !freebieResolution.variantId) {
        console.error('[Gift Guide Freebie] ERROR: Could not resolve Soft Winter Jacket variant');
        window._tissoSyncing = false;
        return;
      }

      console.log('[Gift Guide Freebie] Product ID:', freebieResolution.productId);
      console.log('[Gift Guide Freebie] Product title:', freebieResolution.productTitle);
      console.log('[Gift Guide Freebie] Variant ID:', freebieResolution.variantId);
      console.log('[Gift Guide Freebie] Variant title:', freebieResolution.variantTitle);

      const addUrl = window.routes?.cart_add_url || '/cart/add.js';
      const addRes = await fetch(addUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              id: freebieResolution.variantId,
              quantity: 1,
            },
          ],
        }),
      });

      if (addRes.ok) {
        console.log('[Gift Guide Freebie] Soft Winter Jacket added successfully');
        refreshCartUI();
      } else {
        console.error('[Gift Guide Freebie] Failed to add Soft Winter Jacket to cart:', addRes.status);
      }
      window._tissoSyncing = false;
      return;
    }

    // Rule 2: NO qualifying product exists AND Soft Winter Jacket IS in cart -> REMOVE
    if (!hasQualifying && hasFreebie) {
      window._tissoSyncing = true;
      console.log('[Gift Guide Freebie] Removing Soft Winter Jacket');
      const changeUrl = window.routes?.cart_change_url || '/cart/change.js';
      const changeKey = freebieItem.key || freebieItem.id;

      const removeRes = await fetch(changeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          id: changeKey,
          quantity: 0,
        }),
      });

      if (removeRes.ok) {
        refreshCartUI();
      }
      window._tissoSyncing = false;
      return;
    }

    // Rule 3: Soft Winter Jacket is in cart but with quantity > 1 -> adjust to 1
    if (hasFreebie && freebieItem.quantity > 1) {
      window._tissoSyncing = true;
      const changeUrl = window.routes?.cart_change_url || '/cart/change.js';
      const changeKey = freebieItem.key || freebieItem.id;
      const adjustRes = await fetch(changeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          id: changeKey,
          quantity: 1,
        }),
      });
      if (adjustRes.ok) {
        refreshCartUI();
      }
      window._tissoSyncing = false;
      return;
    }
  } catch (err) {
    console.error('[Gift Guide Freebie] Sync error:', err);
    window._tissoSyncing = false;
  }
}

// Expose globally
window.syncBlackMediumFreebie = syncBlackMediumFreebie;

// Intercept global cart mutation fetches
if (typeof window !== 'undefined' && !window._tissoFetchPatched) {
  window._tissoFetchPatched = true;
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (
        (url.includes('/cart/change') ||
          url.includes('/cart/update') ||
          url.includes('/cart/add') ||
          url.includes('/cart/clear')) &&
        !window._tissoSyncing
      ) {
        setTimeout(() => {
          syncBlackMediumFreebie();
        }, 200);
      }
    } catch (e) {}
    return response;
  };
}

// Subscribe to theme cart events
if (typeof window !== 'undefined') {
  if (typeof window.subscribe === 'function' && window.PUB_SUB_EVENTS?.cartUpdate) {
    window.subscribe(window.PUB_SUB_EVENTS.cartUpdate, (evt) => {
      if (evt?.source !== 'tisso-freebie-sync') {
        syncBlackMediumFreebie();
      }
    });
  }

  // Fallback DOM event listeners on cart changes
  document.addEventListener('change', (evt) => {
    if (
      evt.target.closest('cart-items') ||
      evt.target.closest('cart-drawer-items') ||
      evt.target.closest('.cart-item__quantity')
    ) {
      setTimeout(() => syncBlackMediumFreebie(), 400);
    }
  });

  document.addEventListener('click', (evt) => {
    if (
      evt.target.closest('cart-remove-button') ||
      evt.target.closest('.cart-item__remove') ||
      evt.target.closest('[data-cart-remove]')
    ) {
      setTimeout(() => syncBlackMediumFreebie(), 400);
    }
  });
}

// Global Document-level Delegated Click Listener as a persistent safeguard
document.addEventListener('click', (evt) => {
  const btn = evt.target.closest('.tisso-hotspot-btn');
  if (!btn) return;

  evt.preventDefault();
  evt.stopPropagation();

  const section = btn.closest('.tisso-grid-section') || document.querySelector('.tisso-grid-section');
  if (section && section._tissoInstance) {
    section._tissoInstance.handleHotspotClick(btn);
  } else if (section) {
    const instance = new TissoGiftGuide(section);
    instance.handleHotspotClick(btn);
  }
});

function initTissoGiftGuide() {
  document.querySelectorAll('.tisso-grid-section').forEach((section) => {
    if (!section.dataset.tissoInitialized) {
      section.dataset.tissoInitialized = 'true';
      new TissoGiftGuide(section);
    }
  });

  // Run initial sync on load
  syncBlackMediumFreebie();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTissoGiftGuide);
} else {
  initTissoGiftGuide();
}

// Shopify Theme Editor re-render support
document.addEventListener('shopify:section:load', (event) => {
  const section =
    event.target.querySelector('.tisso-grid-section') ||
    (event.target.classList.contains('tisso-grid-section') ? event.target : null);
  if (section) {
    section.dataset.tissoInitialized = 'true';
    new TissoGiftGuide(section);
  }
});
