// Simple logger for renderer process
const logger = {
    info: (...args) => console.log('[MainWindowUI]', ...args),
    debug: (...args) => console.log('[MainWindowUI DEBUG]', ...args),
    error: (...args) => console.error('[MainWindowUI ERROR]', ...args),
    warn: (...args) => console.warn('[MainWindowUI WARN]', ...args)
};

class MainWindowUI {
    constructor() {
        this.isInteractive = false;
        this.isHidden = false;
        this.currentSkill = '';
        this.codingLanguage = '';
        this.statusDot = null;
        this.skillIndicator = null;
        this.recordButton = null;
        this.transcriptButton = null;
        this.isRecording = false;
        this.speechAvailable = false; // track availability
        this._popoverHideTimeout = null;
        // Renderer-side audio capture state (used for Whisper on Windows)
        this._audioContext = null;
        this._mediaStream = null;
        this._scriptNode = null;
        this._captureInterval = null;
        // Windows system-audio POC state. Kept fully separate from microphone capture.
        this._systemAudioStream = null;
        this._systemAudioContext = null;
        this._systemAudioSource = null;
        this._systemAudioProcessor = null;
        this._systemAudioCaptureActive = false;
        this._systemAudioCaptureAttempt = 0;
        
        // Define available skills for navigation
        this.availableSkills = [];
        
        this.init();
    }

    async init() {
        try {
            this.setupElements();
            this.setupEventListeners();
            
            await this.loadSettingsState();
            
            // Load current interaction state
            await this.loadCurrentInteractionState();
            
            // Fetch speech availability
            await this.loadSpeechAvailability();
            
            this.updateSkillIndicator();
            this.updateAllElementStates(); // Update all elements with current state
            this.resizeWindowToContent();
            
            logger.info('Main window UI initialized', {
                component: 'MainWindowUI',
                skill: this.currentSkill,
                interactive: this.isInteractive
            });

            // Notify the main process that the overlay renderer is ready
            // so it can push the latest speech availability state.
            if (window.electronAPI && window.electronAPI.notifyMainWindowReady) {
                window.electronAPI.notifyMainWindowReady();
            }
            
        } catch (error) {
            logger.error('Failed to initialize main window UI', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadSettingsState() {
        try {
            const [settings, options] = await Promise.all([
                window.electronAPI.getSettings(),
                window.electronAPI.getAvailablePromptOptions()
            ]);
            this.availableSkills = options.skills.map(item => item.id);
            this.currentSkill = settings.activeSkill || '';
            this.updateCodingLanguage(settings.codingLanguage || '');
            this.updateOpacityControl(settings.windowOpacity);
        } catch (error) {
            logger.warn('Failed to load prompt controls', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    updateOpacityControl(value) {
        const opacity = Math.round((Number(value) || 1) * 100);
        if (this.opacitySlider) this.opacitySlider.value = String(opacity);
        if (this.opacityPercent) this.opacityPercent.textContent = `${opacity}%`;
    }

    async loadCurrentInteractionState() {
        try {
            // Request current interaction state from main process
            if (window.electronAPI && window.electronAPI.getWindowStats) {
                const stats = await window.electronAPI.getWindowStats();
                if (stats && typeof stats.isInteractive === 'boolean') {
                    this.isInteractive = stats.isInteractive;
                    const transcriptVisible = !!(stats.windows && stats.windows.chat && stats.windows.chat.isVisible);
                    this.transcriptButton.classList.toggle('active', transcriptVisible);
                    this.transcriptButton.title = transcriptVisible ? 'Hide Live Transcript & Chat' : 'Show Live Transcript & Chat';
                    const aiResponseVisible = !!(stats.windows && stats.windows.llmResponse && stats.windows.llmResponse.isVisible);
                    this.updateAIResponseButton(aiResponseVisible);
                    logger.debug('Loaded current interaction state', {
                        component: 'MainWindowUI',
                        interactive: this.isInteractive
                    });
                }
            }
        } catch (error) {
            // If we can't get the state, assume non-interactive (safer default)
            this.isInteractive = false;
            logger.warn('Failed to load current interaction state, defaulting to non-interactive', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async loadSpeechAvailability() {
        try {
            if (window.electronAPI && window.electronAPI.getSpeechAvailability) {
                this.speechAvailable = await window.electronAPI.getSpeechAvailability();
                this.applyMicVisibility();
            }
        } catch (e) {
            this.speechAvailable = false;
            this.applyMicVisibility();
        }
    }

    applyMicVisibility() {
        if (this.recordButton) {
            if (this.speechAvailable) {
                this.recordButton.style.display = '';
            } else {
                this.recordButton.style.display = 'none';
            }
            // Resize to reflect layout change
            setTimeout(() => this.resizeWindowToContent(), 50);
        }
    }

    updateAllElementStates() {
        // Update all interactive elements with current state
        this.updateStatusDot();
        this.updateSkillIndicatorState();
        this.updateMicButtonState();
        this.updateCodingLanguageState();
        this.updateSettingsIndicatorState();
    }

    updateStatusDot() {
        if (this.statusDot) {
            logger.debug('Updating status dot', {
                component: 'MainWindowUI',
                isInteractive: this.isInteractive,
                currentClasses: this.statusDot.className
            });
            
            // Remove both classes first
            this.statusDot.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.statusDot.classList.add('interactive');
            } else {
                this.statusDot.classList.add('non-interactive');
            }
            
            logger.debug('Status dot updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                newClasses: this.statusDot.className
            });
        } else {
            logger.error('Status dot element not found');
        }
    }

    updateSkillIndicatorState() {
        if (this.skillIndicator) {
            // Remove both classes first
            this.skillIndicator.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.skillIndicator.classList.add('interactive');
            } else {
                this.skillIndicator.classList.add('non-interactive');
            }
            
            logger.debug('Skill indicator state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                classes: this.skillIndicator.className
            });
        }
    }

    updateMicButtonState() {
        if (this.recordButton) {
            // Also hide when unavailable
            this.applyMicVisibility();
            // Remove both classes first
            this.recordButton.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.recordButton.classList.add('interactive');
            } else {
                this.recordButton.classList.add('non-interactive');
            }
            
            // Update button state
            this.recordButton.disabled = !this.isInteractive;
            
            logger.debug('Mic button state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive,
                disabled: !this.isInteractive
            });
        }
    }

    updateCodingLanguage(language) {
        this.codingLanguage = typeof language === 'string' ? language : '';
        if (this.codingLanguageSelect) this.codingLanguageSelect.value = this.codingLanguage;
    }

    updateCodingLanguageState() {
        if (this.codingLanguageSelect) this.codingLanguageSelect.disabled = !this.isInteractive;
    }

    updateSettingsIndicatorState() {
        if (this.settingsIndicator) {
            // Remove both classes first
            this.settingsIndicator.classList.remove('interactive', 'non-interactive');
            
            // Add the appropriate class
            if (this.isInteractive) {
                this.settingsIndicator.classList.add('interactive');
            } else {
                this.settingsIndicator.classList.add('non-interactive');
            }
            
            logger.debug('Settings indicator state updated', {
                component: 'MainWindowUI',
                interactive: this.isInteractive
            });
        } else {
            logger.debug('Settings indicator not found, skipping state update');
        }
    }

    resizeWindowToContent() {
        // Wait for DOM to fully render
        setTimeout(() => {
            const commandTab = document.querySelector('.command-tab');
            if (commandTab && window.electronAPI && window.electronAPI.resizeWindow) {
                const rect = commandTab.getBoundingClientRect();
                const width = Math.ceil(rect.width);
                let height = Math.ceil(rect.height);

                // If shortcuts popover is visible, extend height to fit it
                if (this.shortcutsPopover && this.shortcutsPopover.classList.contains('is-open')) {
                    const popRect = this.shortcutsPopover.getBoundingClientRect();
                    // popover is positioned below the bar (top:36px), add that plus its height and a small margin
                    height = Math.max(height, Math.ceil(36 + popRect.height + 8));
                }
                if (this.opacityPopover && this.opacityPopover.classList.contains('is-open')) {
                    const popRect = this.opacityPopover.getBoundingClientRect();
                    height = Math.max(height, Math.ceil(34 + popRect.height + 8));
                }
                
                logger.debug('Resizing window to content', {
                    width,
                    height,
                    component: 'MainWindowUI'
                });
                
                window.electronAPI.resizeWindow(width, height);
            }
        }, 100);
    }

    setupElements() {
        this.statusDot = document.getElementById('statusDot');
        this.settingsIndicator = document.getElementById('settingsIndicator');
        this.recordButton = document.getElementById('recordButton');
        this.aiResponseButton = document.getElementById('aiResponseButton');
        this.transcriptButton = document.getElementById('transcriptButton');
        this.codingLanguageSelect = document.getElementById('codingLanguageSelect');
        this.opacityButton = document.getElementById('opacityButton');
        this.opacityPopover = document.getElementById('opacityPopover');
        this.opacitySlider = document.getElementById('topBarOpacity');
        this.opacityPercent = document.getElementById('opacityPercent');
    this.infoButton = document.getElementById('infoButton');
    this.shortcutsPopover = document.getElementById('shortcutsPopover');

        // NEW: Screenshot button is the first .command-item without id
        const commandItems = document.querySelectorAll('.command-item');
        this.screenshotButton = commandItems && commandItems[0];

    if (!this.statusDot || !this.recordButton || !this.aiResponseButton || !this.transcriptButton || !this.codingLanguageSelect || !this.opacityButton || !this.opacitySlider || !this.screenshotButton) {
            throw new Error('Required UI elements not found');
        }

        // Screenshot click handler
        this.screenshotButton.addEventListener('click', () => {
            if (this.isInteractive && window.electronAPI && window.electronAPI.takeScreenshot) {
                window.electronAPI.takeScreenshot();
            }
        });

        this.codingLanguageSelect.addEventListener('change', async event => {
            if (!this.isInteractive) return;
            const language = event.target.value;
            try {
                await window.electronAPI.saveSettings({ codingLanguage: language });
            } catch (error) {
                logger.error('Coding language update failed', { error: error.message });
                const settings = await window.electronAPI.getSettings();
                this.updateCodingLanguage(settings.codingLanguage || '');
            }
        });

        this.opacityButton.addEventListener('click', event => {
            event.stopPropagation();
            this.opacityPopover.classList.toggle('is-open');
            this.resizeWindowToContent();
        });
        this.opacityPopover.addEventListener('click', event => event.stopPropagation());
        this.opacitySlider.addEventListener('input', event => {
            const opacity = Number(event.target.value) / 100;
            this.updateOpacityControl(opacity);
            window.electronAPI.saveSettings({ windowOpacity: opacity });
        });
        document.addEventListener('click', () => {
            if (this.opacityPopover.classList.contains('is-open')) {
                this.opacityPopover.classList.remove('is-open');
                this.resizeWindowToContent();
            }
        });

        // Check for required elements (settingsIndicator is optional)
        if (this.settingsIndicator) {
            this.settingsIndicator.addEventListener('click', () => {
                if (this.isInteractive) {
                    this.openSettings();
                }
            });
        }

        this.transcriptButton.addEventListener('click', async () => {
            if (!this.isInteractive) return;
            try {
                const result = await window.electronAPI.toggleChatWindow();
                this.transcriptButton.classList.toggle('active', !!result.visible);
                this.transcriptButton.title = result.visible ? 'Hide Live Transcript & Chat' : 'Show Live Transcript & Chat';
            } catch (error) {
                logger.error('Transcript toggle failed', { error: error.message });
            }
        });

        this.aiResponseButton.addEventListener('click', async () => {
            if (!this.isInteractive) return;
            try {
                const result = await window.electronAPI.toggleAIResponseWindow();
                this.updateAIResponseButton(result.visible);
            } catch (error) {
                logger.error('AI Response toggle failed', { error: error.message });
            }
        });

        this.recordButton.addEventListener('click', async () => {
            if (this.isInteractive && this.speechAvailable) {
                try {
                    if (this.isRecording) {
                        await window.electronAPI.stopSpeechRecognition();
                    } else {
                        await window.electronAPI.startSpeechRecognition();
                    }
                } catch (error) {
                    logger.error('Speech recognition toggle failed', {
                        component: 'MainWindowUI',
                        error: error.message
                    });
                    this.isRecording = false;
                    this.updateMicButtonState();
                }
            } else if (this.isInteractive && !this.speechAvailable) {
                logger.warn('Mic clicked but speech recognition is not available', {
                    component: 'MainWindowUI'
                });
                this.loadSpeechAvailability();
            }
        });

        // Info button / shortcuts popover
        if (this.infoButton && this.shortcutsPopover) {
            this.infoButton.addEventListener('click', (e) => {
                if (!this.isInteractive) return;
                e.stopPropagation();
                this.toggleShortcutsPopover();
            });

            // Hover to show
            this.infoButton.addEventListener('mouseenter', () => {
                if (!this.isInteractive) return;
                this.showShortcutsPopover();
            });
            // Queue hide when leaving the button
            this.infoButton.addEventListener('mouseleave', () => this.queueHideShortcutsPopover());

            // Keep open when hovering popover
            this.shortcutsPopover.addEventListener('mouseenter', () => {
                if (this._popoverHideTimeout) {
                    clearTimeout(this._popoverHideTimeout);
                    this._popoverHideTimeout = null;
                }
            });
            // Hide after a small delay when leaving popover
            this.shortcutsPopover.addEventListener('mouseleave', () => this.queueHideShortcutsPopover());

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (!this.shortcutsPopover) return;
                const isClickInside = this.shortcutsPopover.contains(e.target) || this.infoButton.contains(e.target);
                if (!isClickInside && this.shortcutsPopover.classList.contains('is-open')) {
                    this.hideShortcutsPopover();
                }
            });

            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.shortcutsPopover && this.shortcutsPopover.classList.contains('is-open')) {
                    this.hideShortcutsPopover();
                }
            });
        }
    }

    setupEventListeners() {
        if (window.electronAPI) {
            // Fix interaction mode change listener
            window.electronAPI.onInteractionModeChanged((event, interactive) => {
                logger.debug('Interaction mode changed received:', interactive);
                this.handleInteractionModeChanged(interactive);
            });

            window.electronAPI.onRecordingStarted(() => {
                this.handleRecordingStarted();
            });

            window.electronAPI.onRecordingStopped(() => {
                this.handleRecordingStopped();
            });

            window.electronAPI.onSkillChanged((event, data) => {
                if (data && Object.prototype.hasOwnProperty.call(data, 'skill')) {
                    this.handleSkillChanged(data);
                }
            });

            window.electronAPI.onCodingLanguageChanged((_event, data) => {
                if (data && Object.prototype.hasOwnProperty.call(data, 'language')) {
                    this.updateCodingLanguage(data.language || '');
                }
            });

            window.electronAPI.onSpeechAvailability((event, data) => {
                this.speechAvailable = !!(data && data.available);
                this.applyMicVisibility();
            });

            window.electronAPI.receive('skill-updated', (_event, data) => {
                if (data && Object.prototype.hasOwnProperty.call(data, 'skill')) this.handleSkillChanged(data);
            });
            window.electronAPI.onAppearanceChanged((_event, appearance) => {
                if (appearance) this.updateOpacityControl(appearance.windowOpacity);
            });
            window.electronAPI.onAIResponseVisibilityChanged((_event, state) => {
                this.updateAIResponseButton(!!(state && state.visible));
            });
            window.electronAPI.onChatWindowVisibilityChanged((_event, state) => {
                const visible = !!(state && state.visible);
                this.transcriptButton.classList.toggle('active', visible);
                this.transcriptButton.title = visible ? 'Hide Live Transcript & Chat' : 'Show Live Transcript & Chat';
            });

            // Listen for main window shown event to refresh speech availability
            window.electronAPI.onMainWindowShown(() => {
                logger.debug('Main window shown - refreshing speech availability', {
                    component: 'MainWindowUI'
                });
                this.loadSpeechAvailability();
            });
            
            // Global keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.altKey && e.key === 'm' && this.isInteractive) {
                    e.preventDefault();
                    if (!this.speechAvailable) return; // guard when unavailable
                    if (this.isRecording) {
                        window.electronAPI.stopSpeechRecognition();
                    } else {
                        window.electronAPI.startSpeechRecognition();
                    }
                }
            });
        }
        
        // Also listen via the api interface for backup
        if (window.api) {
            
            window.api.receive('interaction-mode-changed', (interactive) => {
                logger.debug('Interaction mode changed via api:', interactive);
                this.handleInteractionModeChanged(interactive);
            });
            
            window.api.receive('skill-updated', (data) => {
                logger.info('Skill updated event received from main process:', data);
                if (data && Object.prototype.hasOwnProperty.call(data, 'skill')) {
                    this.handleSkillChanged(data);
                } else if (typeof data === 'string') {
                    // Handle case where skill is passed directly as string
                    this.handleSkillChanged({ skill: data });
                } else {
                    logger.warn('Skill updated event received but no skill data found:', data);
                }
            });
            
            // Listen for skill updates from settings window  
            window.api.receive('update-skill', (skill) => {
                logger.info('Direct skill update received from settings:', skill);
                this.handleSkillChanged({ skill: skill });
            });
        } else {
            logger.error('window.api not available - event listeners not set up!');
        }
        
        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        // Settings shortcut
        this.setupSettingsShortcut();
    }

    handleLLMResponse(data) {
        const skill = data.skill || data.metadata?.skill || 'General';
        const skillNames = {
            'dsa': 'DSA',
            'behavioral': 'Behavioral', 
            'sales': 'Sales',
            'presentation': 'Presentation',
            'data-science': 'Data Science',
            'programming': 'Programming',
            'devops': 'DevOps',
            'system-design': 'System Design',
            'negotiation': 'Negotiation'
        };
        
        const displaySkill = skillNames[skill] || skill.toUpperCase();
        
        logger.info('LLM response received', {
            component: 'MainWindowUI',
            skill: skill,
            displaySkill: displaySkill
        });
    }

    handleLLMError(data) {
        logger.error('LLM error received', {
            component: 'MainWindowUI',
            error: data.error
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.metaKey && e.key === '\\') {
                this.isHidden = !this.isHidden;
                if (this.isHidden) {
                    this.showHiddenIndicator();
                }
            }
            
            // Handle Cmd + Arrow keys based on interaction mode
            if (e.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();

                if (this.isInteractive) {
                    // Interactive mode: Cmd + Up/Down for skill navigation
                    if (e.key === 'ArrowUp') {
                        this.navigateSkill(-1); // Previous skill
                    } else if (e.key === 'ArrowDown') {
                        this.navigateSkill(1); // Next skill
                    } else {
                    }
                    // Left/Right arrows do nothing in interactive mode
                } else {
                    // Non-interactive mode: Cmd + Arrow keys for window movement
                    this.moveWindow(e.key);
                }
            }
            
            // Alt+A is handled globally by the main process
            // No need to handle it here since it needs to work even when windows are non-interactive
        });
    }

    handleInteractionModeChanged(interactive) {
        logger.info('Handling interaction mode change', {
            component: 'MainWindowUI',
            newState: interactive,
            previousState: this.isInteractive
        });
        
        // Update the internal state
        this.isInteractive = interactive;
        
        // Update all UI elements to reflect the new state
        this.updateAllElementStates();

        // Auto-hide popover when leaving interactive mode
        if (!this.isInteractive && this.shortcutsPopover && this.shortcutsPopover.style.display !== 'none') {
            this.hideShortcutsPopover();
        }
        
        // Update skill indicator tooltip
        this.updateSkillIndicator();
        
        logger.info('Interaction mode change completed', {
            component: 'MainWindowUI',
            interactive: this.isInteractive,
            statusDotClass: this.statusDot ? this.statusDot.className : 'not found',
            skillIndicatorClass: this.skillIndicator ? this.skillIndicator.className : 'not found'
        });
    }

    handleSkillChanged(data) {
        const oldSkill = this.currentSkill;
        this.currentSkill = data.skill;
        
        logger.info('Handling skill change', {
            component: 'MainWindowUI',
            oldSkill: oldSkill,
            newSkill: data.skill,
            skillIndicatorExists: !!this.skillIndicator
        });
        
        this.updateSkillIndicator();
        
        logger.info('Skill changed successfully', {
            component: 'MainWindowUI',
            skill: data.skill
        });
    }

    handleSkillActivated(skillName) {
        this.currentSkill = skillName;
        this.updateSkillIndicator();
        
        logger.info('Skill activated', {
            component: 'MainWindowUI',
            skill: skillName
        });
    }

    updateAIResponseButton(visible) {
        if (!this.aiResponseButton) return;
        this.aiResponseButton.classList.toggle('active', !!visible);
        this.aiResponseButton.title = visible ? 'Hide AI Response' : 'Show AI Response';
    }

    handleScreenshotRequest() {
        logger.debug('Screenshot request received', { component: 'MainWindowUI' });
    }

    handleRecordingStarted() {
        this.isRecording = true;
        if (this.recordButton) {
            this.recordButton.classList.add('recording');
            this.recordButton.querySelector('span').textContent = 'Stop';
            this.recordButton.title = 'Stop Voice Recording';
        }
        // On Windows and macOS, Whisper audio is captured here in the renderer
        // (Web Audio API) rather than the main process: Windows lacks sox/rec/
        // arecord, and macOS avoids an unbundled Homebrew `sox`. Must match the
        // main process's useRendererCapture gate (speech.service.js). Linux uses
        // the native recorder. navigator.userAgentData is preferred when present
        // since navigator.platform is deprecated.
        const platform = (typeof navigator !== 'undefined' &&
          ((navigator.userAgentData && navigator.userAgentData.platform) ||
            navigator.platform || '')).toLowerCase();
        const useRendererCapture = platform.includes('win') || platform.includes('mac');
        if (useRendererCapture) {
            this._startRendererAudioCapture();
        }
        if (platform.includes('win')) {
            this._startSystemAudioCapture();
        }
        logger.debug('Recording started', { component: 'MainWindowUI' });
    }

    handleRecordingStopped() {
        this.isRecording = false;
        if (this.recordButton) {
            this.recordButton.classList.remove('recording');
            this.recordButton.querySelector('span').textContent = 'Record';
            this.recordButton.title = 'Start Voice Recording';
        }
        this._stopRendererAudioCapture();
        this._stopSystemAudioCapture();
        logger.debug('Recording stopped', { component: 'MainWindowUI' });
    }

    /**
     * Capture microphone audio in the renderer using the Web Audio API.
     * This is used for Whisper on Windows where node-record-lpcm16's sox/rec
     * dependencies are unavailable.
     */
    async _startRendererAudioCapture() {
        try {
            this._stopRendererAudioCapture();

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: { ideal: 16000 }
                }
            });
            this._mediaStream = stream;

            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            this._audioContext = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            const bufferSize = 4096;
            const scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
            this._scriptNode = scriptNode;

            scriptNode.onaudioprocess = (event) => {
                if (!this.isRecording || !window.electronAPI || !window.electronAPI.sendAudioChunk) {
                    return;
                }
                const inputData = event.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                window.electronAPI.sendAudioChunk(pcm16.buffer);
            };

            source.connect(scriptNode);
            scriptNode.connect(audioContext.destination);

            logger.info('Renderer audio capture started', { component: 'MainWindowUI' });
        } catch (error) {
            logger.error('Failed to start renderer audio capture', {
                component: 'MainWindowUI',
                error: error.message
            });
            // Notify main process so it can stop the recording state
            try {
                await window.electronAPI.stopSpeechRecognition();
            } catch (_) { /* ignore */ }
        }
    }

    _stopRendererAudioCapture() {
        try {
            if (this._scriptNode) {
                this._scriptNode.disconnect();
                this._scriptNode.onaudioprocess = null;
                this._scriptNode = null;
            }
            if (this._mediaStream) {
                this._mediaStream.getTracks().forEach((track) => track.stop());
                this._mediaStream = null;
            }
            if (this._audioContext) {
                this._audioContext.close().catch(() => {});
                this._audioContext = null;
            }
            if (this._captureInterval) {
                clearInterval(this._captureInterval);
                this._captureInterval = null;
            }
        } catch (error) {
            logger.error('Error stopping renderer audio capture', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async _startSystemAudioCapture() {
        this._stopSystemAudioCapture();
        const captureAttempt = ++this._systemAudioCaptureAttempt;

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                throw new Error('Display media capture is unavailable');
            }

            const stream = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                video: true
            });

            if (captureAttempt !== this._systemAudioCaptureAttempt || !this.isRecording) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                stream.getTracks().forEach((track) => track.stop());
                throw new Error('System audio stream did not contain an audio track');
            }

            // Electron requires a display source for loopback capture. The video
            // track is not rendered or retained by this audio-only POC.
            stream.getVideoTracks().forEach((track) => track.stop());
            this._systemAudioStream = stream;

            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            this._systemAudioContext = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            this._systemAudioSource = source;
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            this._systemAudioProcessor = processor;

            processor.onaudioprocess = (event) => {
                if (!this._systemAudioCaptureActive || !window.electronAPI?.sendSystemAudioChunk) {
                    return;
                }
                const inputData = event.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(inputData.length);
                for (let index = 0; index < inputData.length; index += 1) {
                    const sample = Math.max(-1, Math.min(1, inputData[index]));
                    pcm16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                }
                window.electronAPI.sendSystemAudioChunk(pcm16.buffer);
            };

            source.connect(processor);
            processor.connect(audioContext.destination);
            this._systemAudioCaptureActive = true;
            audioTracks[0].addEventListener('ended', () => {
                if (this._systemAudioStream === stream) this._stopSystemAudioCapture();
            }, { once: true });
            window.electronAPI?.setSystemAudioCaptureState?.(true);
            logger.info('Windows system audio capture started', {
                component: 'MainWindowUI',
                sampleRate: audioContext.sampleRate
            });
        } catch (error) {
            if (captureAttempt === this._systemAudioCaptureAttempt) {
                this._stopSystemAudioCapture();
                logger.warn('Windows system audio capture unavailable; microphone remains active', {
                    component: 'MainWindowUI',
                    error: error.message
                });
            }
        }
    }

    _stopSystemAudioCapture() {
        this._systemAudioCaptureAttempt += 1;
        const wasActive = this._systemAudioCaptureActive;
        this._systemAudioCaptureActive = false;

        if (this._systemAudioProcessor) {
            this._systemAudioProcessor.onaudioprocess = null;
            try { this._systemAudioProcessor.disconnect(); } catch (_) {}
            this._systemAudioProcessor = null;
        }
        if (this._systemAudioSource) {
            try { this._systemAudioSource.disconnect(); } catch (_) {}
            this._systemAudioSource = null;
        }
        if (this._systemAudioStream) {
            const stream = this._systemAudioStream;
            this._systemAudioStream = null;
            stream.getTracks().forEach((track) => track.stop());
        }
        if (this._systemAudioContext) {
            this._systemAudioContext.close().catch(() => {});
            this._systemAudioContext = null;
        }
        if (wasActive) {
            window.electronAPI?.setSystemAudioCaptureState?.(false);
            logger.info('Windows system audio capture stopped', { component: 'MainWindowUI' });
        }
    }

    updateSkillIndicator() {
        if (this.skillSelect) this.skillSelect.value = this.currentSkill || '';
    }

    animateSkillChange() {
        if (this.skillIndicator) {
            this.skillIndicator.style.transform = 'scale(1.1)';
            this.skillIndicator.style.transition = 'transform 0.2s ease';
            
            setTimeout(() => {
                this.skillIndicator.style.transform = 'scale(1)';
            }, 200);
        }
    }

    navigateSkill(direction) {
        
        if (!this.isInteractive) {
            return;
        }
        
        const currentIndex = this.availableSkills.indexOf(this.currentSkill);
        if (currentIndex === -1) {
            logger.error('Current skill not found in available skills array');
            return;
        }
        
        // Calculate new index with wrapping
        let newIndex = currentIndex + direction;
        if (newIndex >= this.availableSkills.length) {
            newIndex = 0; // Wrap to beginning
        } else if (newIndex < 0) {
            newIndex = this.availableSkills.length - 1; // Wrap to end
        }
        
        const newSkill = this.availableSkills[newIndex];
        
        // Update skill locally and notify main process
        this.currentSkill = newSkill;
        this.updateSkillIndicator();
        
        // Save the skill change via IPC
        if (window.electronAPI && window.electronAPI.updateActiveSkill) {
            window.electronAPI.updateActiveSkill(newSkill).then(() => {
                logger.info('Skill navigation completed', {
                    component: 'MainWindowUI',
                    newSkill,
                    direction: direction > 0 ? 'down' : 'up'
                });
            }).catch(error => {
                logger.error('Failed to update skill via navigation', {
                    component: 'MainWindowUI',
                    error: error.message
                });
            });
        }
        
        // Show visual feedback
        this.showSkillChangeNotification(newSkill, direction);
    }

    showSkillChangeNotification(skill, direction) {
        const skillNames = {
            'dsa': 'DSA',
            'behavioral': 'Behavioral', 
            'sales': 'Sales',
            'presentation': 'Presentation',
            'data-science': 'Data Science',
            'programming': 'Programming',
            'devops': 'DevOps',
            'system-design': 'System Design',
            'negotiation': 'Negotiation'
        };
        
        const displayName = skillNames[skill] || skill.toUpperCase();
        const arrow = direction > 0 ? '↓' : '↑';
        
        // Create temporary notification
        const notification = document.createElement('div');
        notification.className = 'skill-change-notification';
        notification.innerHTML = `${arrow} ${displayName}`;
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.opacity = '1';
        }, 10);
        
        // Remove after 1 second
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 200);
        }, 1000);
    }

    showHiddenIndicator() {
        const indicator = document.querySelector('.hidden-indicator');
        if (indicator) {
            indicator.classList.add('show');
            setTimeout(() => {
                indicator.classList.remove('show');
            }, 3000);
        }
    }

    toggleInteractiveMode() {
        this.isInteractive = !this.isInteractive;
        this.updateAllElementStates();
        
        logger.debug('Interactive mode toggled', {
            component: 'MainWindowUI',
            interactive: this.isInteractive
        });
    }

    moveWindow(direction) {
        const moveDistance = 20; // pixels
        
        if (window.electronAPI && window.electronAPI.moveWindow) {
            let deltaX = 0, deltaY = 0;
            
            switch(direction) {
                case 'ArrowUp':
                    deltaY = -moveDistance;
                    break;
                case 'ArrowDown':
                    deltaY = moveDistance;
                    break;
                case 'ArrowLeft':
                    deltaX = -moveDistance;
                    break;
                case 'ArrowRight':
                    deltaX = moveDistance;
                    break;
            }
            
            window.electronAPI.moveWindow(deltaX, deltaY);
            logger.debug('Moving window', {
                component: 'MainWindowUI',
                direction: direction,
                deltaX: deltaX,
                deltaY: deltaY,
                interactive: this.isInteractive
            });
        } else {
            logger.warn('moveWindow API not available', { component: 'MainWindowUI' });
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg text-white z-50 ${
            type === 'error' ? 'bg-red-600' : 
            type === 'success' ? 'bg-green-600' :
            'bg-blue-600'
        }`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
        
        logger.debug('Notification shown', {
            component: 'MainWindowUI',
            message,
            type
        });
    }

    async showGeminiConfig() {
        try {
            const status = await window.electronAPI.getGeminiStatus();
            
            const modal = this.createGeminiConfigModal(status);
            document.body.appendChild(modal);
            
            logger.debug('Gemini config modal shown', { component: 'MainWindowUI' });
        } catch (error) {
            logger.error('Failed to show Gemini config', {
                component: 'MainWindowUI',
                error: error.message
            });
            this.showNotification('Failed to load Gemini configuration', 'error');
        }
    }

    createGeminiConfigModal(status) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-gray-900 text-white p-6 rounded-lg max-w-md w-full">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">🤖 Gemini Flash 1.5 Configuration</h2>
                    <button class="text-gray-400 hover:text-white" onclick="this.closest('.fixed').remove()">✕</button>
                </div>
                
                <div class="mb-4 p-3 rounded ${status.hasApiKey ? 'bg-green-900' : 'bg-red-900'}">
                    <p><strong>Status:</strong> ${status.hasApiKey ? 'Configured' : 'Not Configured'}</p>
                    <p><strong>Model:</strong> ${status.model}</p>
                </div>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium mb-2">API Key:</label>
                    <input type="password" id="geminiApiKey" placeholder="Enter your Gemini API key" 
                           class="w-full p-2 bg-gray-800 border border-gray-600 rounded text-white">
                    <p class="text-xs text-gray-400 mt-1">
                        Get your API key from: <a href="https://aistudio.google.com/app/apikey" target="_blank" class="text-blue-400">Google AI Studio</a>
                    </p>
                </div>
                
                <div class="flex space-x-2">
                    <button onclick="mainWindowUI.configureGemini()" class="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
                        Configure
                    </button>
                    <button onclick="mainWindowUI.testGeminiConnection()" class="flex-1 bg-green-600 hover:bg-green-700 px-4 py-2 rounded">
                        Test Connection
                    </button>
                </div>
                
                <div class="mt-4 text-center">
                    <button class="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded" onclick="this.closest('.fixed').remove()">
                        Close
                    </button>
                </div>
            </div>
        `;
        return modal;
    }

    async configureGemini() {
        const apiKey = document.getElementById('geminiApiKey').value.trim();
        if (!apiKey) {
            this.showNotification('Please enter an API key', 'error');
            return;
        }
        
        try {
            const result = await window.electronAPI.setGeminiApiKey(apiKey);
            if (result.success) {
                this.showNotification('Gemini API key configured successfully!', 'success');
                document.querySelector('.fixed').remove();
                
                logger.info('Gemini API key configured', { component: 'MainWindowUI' });
            } else {
                this.showNotification(`Configuration failed: ${result.error}`, 'error');
                logger.error('Gemini configuration failed', {
                    component: 'MainWindowUI',
                    error: result.error
                });
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
            logger.error('Gemini configuration error', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    async testGeminiConnection() {
        try {
            const result = await window.electronAPI.testGeminiConnection();
            if (result.success) {
                this.showNotification('Gemini connection test successful!', 'success');
                logger.info('Gemini connection test successful', { component: 'MainWindowUI' });
            } else {
                this.showNotification(`Connection test failed: ${result.error}`, 'error');
                logger.error('Gemini connection test failed', {
                    component: 'MainWindowUI',
                    error: result.error
                });
            }
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
            logger.error('Gemini connection test error', {
                component: 'MainWindowUI',
                error: error.message
            });
        }
    }

    setupSettingsShortcut() {
        document.addEventListener('keydown', (e) => {
            // Cmd+, or Ctrl+, for settings
            if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                logger.debug('Settings keyboard shortcut pressed');
                e.preventDefault();
                this.openSettings();
            }
        });
    }

    openSettings() {
        try {
            if (window.electronAPI && window.electronAPI.showSettings) {
                window.electronAPI.showSettings();
            } else {
                logger.error('electronAPI or showSettings not available');
                return;
            }
            
            // Add visual feedback
            if (this.settingsIndicator) {
                this.settingsIndicator.style.transform = 'scale(1.1)';
                this.settingsIndicator.style.transition = 'transform 0.2s ease';
                
                setTimeout(() => {
                    this.settingsIndicator.style.transform = 'scale(1)';
                }, 200);
            }
            
            logger.info('Settings window opened', { component: 'MainWindowUI' });
        } catch (error) {
            logger.error('Failed to open settings', {
                component: 'MainWindowUI',
                error: error.message
            });
            this.showNotification('Failed to open settings', 'error');
        }
    }

    showSettingsMenu() {
        const menu = document.createElement('div');
        menu.className = 'settings-menu';
        menu.style.cssText = `
            position: absolute;
            right: 10px;
            top: 35px;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(20px);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 8px 0;
            min-width: 150px;
            z-index: 1000;
        `;

        const settingsOption = this.createMenuItem('Settings', 'fa-cog', () => {
            this.openSettings();
            document.body.removeChild(menu);
        });

        const quitOption = this.createMenuItem('Quit OpenCluely', 'fa-power-off', () => {
            if (window.electronAPI && window.electronAPI.quit) {
                window.electronAPI.quit();
            }
        });

        menu.appendChild(settingsOption);
        menu.appendChild(this.createMenuSeparator());
        menu.appendChild(quitOption);

        // Add click outside listener to close menu
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !this.settingsIndicator.contains(e.target)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);

        document.body.appendChild(menu);
    }

    createMenuItem(text, iconClass, onClick) {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 8px 16px;
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        `;
        item.innerHTML = `<i class="fas ${iconClass}"></i>${text}`;
        item.addEventListener('mouseover', () => {
            item.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        item.addEventListener('mouseout', () => {
            item.style.background = 'transparent';
        });
        item.addEventListener('click', onClick);
        return item;
    }

    createMenuSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
            margin: 8px 0;
        `;
        return separator;
    }

    toggleShortcutsPopover() {
        if (!this.shortcutsPopover) return;
    const isOpen = this.shortcutsPopover.classList.contains('is-open');
    if (!isOpen) {
            this.showShortcutsPopover();
        } else {
            this.hideShortcutsPopover();
        }
    }

    showShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        if (this._popoverHideTimeout) {
            clearTimeout(this._popoverHideTimeout);
            this._popoverHideTimeout = null;
        }
    this.shortcutsPopover.classList.add('is-open');
        // Resize main window to fit popover
        setTimeout(() => this.resizeWindowToContent(), 50);
    }

    hideShortcutsPopover() {
        if (!this.shortcutsPopover) return;
    this.shortcutsPopover.classList.remove('is-open');
    // resize back to compact after transition
    setTimeout(() => this.resizeWindowToContent(), 130);
    }

    queueHideShortcutsPopover() {
        if (!this.shortcutsPopover) return;
        if (this._popoverHideTimeout) clearTimeout(this._popoverHideTimeout);
        this._popoverHideTimeout = setTimeout(() => this.hideShortcutsPopover(), 180);
    }
}

// Initialize when DOM is ready
let mainWindowUI;
if (typeof document !== 'undefined') {
    // Add immediate visual indicator that script is loading
    const style = document.createElement('style');
    document.head.appendChild(style);
    
    document.addEventListener('DOMContentLoaded', () => {
                
        mainWindowUI = new MainWindowUI();
        // Make it globally accessible for debugging
        window.mainWindowUI = mainWindowUI;
        logger.info('MainWindowUI initialized and available as window.mainWindowUI');
    });
}

// module.exports = MainWindowUI; // Not needed in browser context
