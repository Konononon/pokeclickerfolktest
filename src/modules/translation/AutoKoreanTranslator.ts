import type Setting from '../settings/Setting';
import Language from './Language';

const TRANSLATABLE_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'value'] as const;
const ENGLISH_TEXT = /[A-Za-z]/;
const HAS_HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;

export default class AutoKoreanTranslator {
    private observer?: MutationObserver;
    private enabled = false;
    private cache: Record<string, string>;
    private pending = new Map<string, Promise<string>>();

    constructor(languageSetting: Setting<Language>) {
        this.cache = JSON.parse(localStorage.getItem('koAutoTranslationCache') || '{}');

        languageSetting.observableValue.subscribe((lang) => {
            if (lang === Language.ko) {
                this.enable();
            } else {
                this.disable();
            }
        });

        if (languageSetting.value === Language.ko) {
            this.enable();
        }
    }

    private enable() {
        if (this.enabled) {
            return;
        }

        if (!document.body) {
            document.addEventListener('DOMContentLoaded', () => this.enable(), { once: true });
            return;
        }

        this.enabled = true;
        this.translateSubtree(document.body);
        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'characterData') {
                    this.translateTextNode(mutation.target as Text);
                }

                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        this.translateTextNode(node as Text);
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        this.translateSubtree(node as Element);
                    }
                });
            });
        });

        this.observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
        });
    }

    private disable() {
        this.enabled = false;
        this.observer?.disconnect();
    }

    private translateSubtree(root: Element) {
        this.translateAttributes(root);

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            this.translateTextNode(node as Text);
            node = walker.nextNode();
        }

        root.querySelectorAll('*').forEach((el) => this.translateAttributes(el));
    }

    private translateAttributes(element: Element) {
        TRANSLATABLE_ATTRIBUTES.forEach((attr) => {
            const value = element.getAttribute(attr);
            if (!value) {
                return;
            }
            this.translateText(value).then((translated) => {
                if (translated !== value) {
                    element.setAttribute(attr, translated);
                }
            });
        });
    }

    private translateTextNode(node: Text) {
        const original = node.nodeValue || '';
        if (!this.isTranslatable(original)) {
            return;
        }

        this.translateText(original).then((translated) => {
            if (!this.enabled || node.nodeValue !== original || translated === original) {
                return;
            }
            node.nodeValue = translated;
        });
    }

    private isTranslatable(text: string) {
        const trimmed = text.trim();
        if (!trimmed || !ENGLISH_TEXT.test(trimmed) || HAS_HANGUL.test(trimmed)) {
            return false;
        }

        if (trimmed.length > 180 || trimmed.includes('http') || trimmed.includes('assets/')) {
            return false;
        }

        return true;
    }

    private async translateText(text: string): Promise<string> {
        if (!this.isTranslatable(text)) {
            return text;
        }

        if (this.cache[text]) {
            return this.cache[text];
        }

        if (!this.pending.has(text)) {
            this.pending.set(text, this.requestTranslation(text)
                .then((translated) => {
                    this.cache[text] = translated;
                    localStorage.setItem('koAutoTranslationCache', JSON.stringify(this.cache));
                    return translated;
                })
                .finally(() => {
                    this.pending.delete(text);
                }));
        }

        return this.pending.get(text);
    }

    private async requestTranslation(text: string): Promise<string> {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
            const response = await fetch(url);
            const json = await response.json();
            const translated = json?.[0]?.map((part) => part?.[0]).join('')?.trim();
            return translated || text;
        } catch {
            return text;
        }
    }
}
