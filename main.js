const puppeteer = require('puppeteer-extra');
const randomUA = require('user-agents');
const SYMBOLS = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~0123456789-`;
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const useProxy = require('./modules/puppeteer-page-proxy');
const fs = require('fs').promises;

const CAPTCHA_TOKEN = "TOKEN";
if(CAPTCHA_TOKEN == "TOKEN") {
    throw new Error("Change the captcha token in the CAPTCHA_TOKEN variable.");
}

puppeteer.use(
    RecaptchaPlugin({
        provider: {
            id: '2captcha',
            token: 'TOKEN' // REPLACE THIS WITH YOUR OWN 2CAPTCHA API KEY ⚡
        },
        visualFeedback: true // colorize reCAPTCHAs (violet = detected, green = solved)
    })
);

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitAndInput(page, selector, value) {
    console.log(`[${selector}] Waiting for selector to load`);
    await page.waitForSelector(selector);
    console.log(`[${selector}] Setting value`, value);
    await page.type(selector, value);
}

async function waitAndClick(page, selector) {
    await page.waitForSelector(selector);
    return await page.click(selector);
}

async function genName(browser) {
    const page = await browser.newPage();
    await page.goto('https://en.wikipedia.org/wiki/Special:Random');
    const element = await page.waitForSelector('.firstHeading');
    let heading = await element.evaluate(el => el.textContent);
    console.log("[NameGen] Heading:", heading);
    await page.close();

    // remove weird symbols and digits
    for (const symbol of SYMBOLS) {
        heading = heading.replaceAll(symbol, "");
    }
    // remove spaces
    heading = heading.split(" ").join("");
    console.log("[NameGen] Cleaned up:", heading);
    // get part of it
    heading = heading.slice(0, randInt(5, heading.length > 7 ? 7 : heading.length));

    // add numbers to random place
    const placing = randInt(0, 2);
    const numbers = randInt(10000, 99999);
    if (placing == 0) {
        return heading + numbers;
    } else if (placing == 1) {
        return numbers + heading;
    } else {
        const half = Math.ceil(heading.length / 2);
        const start = heading.slice(0, half);
        const end = heading.slice(-half);

        return start + numbers + end;
    }
}

const PROXIES = {
    used: [],
    dead: [],
    all: [
        {
            url: 'http://user:pass@ip:port',
            used_at: 0,
        },
    ],
};

if(PROXIES.all[0].url == "http://user:pass@ip:port") {
    throw new Error("Change proxies in the PROXIES variable");
}

const TEN_MINUTES = 600000;

async function proxify(page) {
    console.log("[PROXIFY] Picking proxy");
    if (PROXIES.all.length == 0) {
        if (PROXIES.used.length == 0) {
            throw new Error("[PROXIFY] ALL PROXIES ARE DEAD");
        }
        console.log("[PROXIFY] ROTATING PROXIES");
        PROXIES.all = [...PROXIES.used];
        PROXIES.used = [];
    }
    const proxy = PROXIES.all.pop();
    console.log("[PROXIFY] Picked", proxy.url);
    if (proxy.used_at) {
        const now = (new Date()).getTime();
        const diff = now - proxy.used_at;
        if (diff - TEN_MINUTES > 0) {
            console.log("[PROXIFY] Proxy has been used. Sleeping for %d ms", diff);
            await sleep(diff);
        }
    }
    console.log("[PROXIFY] Attaching proxy to page...");
    await useProxy(page, proxy.url);

    console.log("[PROXIFY] Looking up proxy...");
    const res = await useProxy.lookup(page).catch(async err => {
        console.error(err);
        console.log("[PROXIFY] Proxy", proxy.url, "is dead");
        PROXIES.dead.push(proxy);
        return await proxify(page);
    });
    console.log(`[PROXIFY]`, res);
    proxy.used_at = (new Date()).getTime();
    PROXIES.used.push(proxy);
    return page;
}


const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.75 Safari/537.36';

async function createPage(browser, url) {

    //Randomize User agent or Set a valid one
    const userAgent = randomUA.toString();
    const UA = userAgent || USER_AGENT;
    const page = await browser.newPage();

    //Randomize viewport size
    await page.setViewport({
        width: 1920 + Math.floor(Math.random() * 100),
        height: 3000 + Math.floor(Math.random() * 100),
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: false,
        isMobile: false,
    });

    await page.setUserAgent(UA);
    await page.setJavaScriptEnabled(true);
    await page.setDefaultNavigationTimeout(0);

    //Skip images/styles/fonts loading for performance
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        // if(req.method() == "GET") {
        //     console.log(req.url(), req.resourceType(), req.headers());
        // }
        if (req.url() == "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js") {
            return req.abort(); //fuck off apple
        }
        if (req.resourceType() == 'stylesheet' || req.resourceType() == 'font' || req.resourceType() == 'image') {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.evaluateOnNewDocument(() => {
        // Pass webdriver check
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
    });

    await page.evaluateOnNewDocument(() => {
        // Pass chrome check
        window.chrome = {
            runtime: {},
            // etc.
        };
    });

    await page.evaluateOnNewDocument(() => {
        //Pass notifications check
        const originalQuery = window.navigator.permissions.query;
        return window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });

    await page.evaluateOnNewDocument(() => {
        // Overwrite the `plugins` property to use a custom getter.
        Object.defineProperty(navigator, 'plugins', {
            // This just needs to have `length > 0` for the current test,
            // but we could mock the plugins too if necessary.
            get: () => [1, 2, 3, 4, 5],
        });
    });

    await page.evaluateOnNewDocument(() => {
        // Overwrite the `languages` property to use a custom getter.
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
    });

    await proxify(page);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });
    return page;
}

async function appendAccount(account) {
    fs.appendFile("accounts.txt", account + "\n", 'utf8');
}


(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 0, // slow down by 250ms
    });
    const name = await genName(browser);
    console.log("[NameGen] Generated name", name);

    console.log("[Reddit] Starting register process...");
    const page = await createPage(browser, 'https://www.reddit.com/account/register/');
    await waitAndInput(page, "#regEmail", "forkneif@gmail.com");
    await waitAndClick(page, "button.AnimatedForm__submitButton");
    await sleep(1000);
    await waitAndInput(page, "#regUsername", name);
    const numbers = randInt(10000, 99999);
    await waitAndInput(page, "#regPassword", "jannasharplover" + numbers);
    console.log("[Reddit] Solving captcha...");
    await page.solveRecaptchas();
    console.log("[Reddit] Should have solved...");
    await page.click(`.SignupButton`);

    console.log("[Reddit] Waiting for navigation...");
    const finalResponse = await page.waitForResponse(async response => {
        if (response.url() === "https://www.reddit.com/register" && response.request().method() === 'POST') {
            return response.json();
        }
    }, 20);
    const json = await finalResponse.json();
    console.log(`[Reddit] Response from register request: `, json);
    if (json.code == 400) {
        if (json.reason == "RATELIMIT") {
            console.log("[Reddit] Rate limitted...");
            const regex = /(d+) minute/g;
            const minutes = [...json.explanation.matchAll(regex)][0][1];
            const ms = minutes * 1000 * 60 || 1000;
            console.log("[Reddit] Sleeping for %d ms", ms);
            await sleep(ms);
            console.log("[Reddit] Trying again...");
            await page.click(`.SignupButton`);
        }
    }
    //await page.waitForNavigation({ waitUntil: ['networkidle2'] });
    const amount = randInt(5, 12);
    console.log("[Reddit] Subscribing to %d random subreddits...", amount);

    await page.evaluate((amount) => {
        const items = [...document.querySelectorAll(".AnimatedForm__subscribeButton")];
        for (let i = 0; i < amount; i++) {
            var item = items[Math.floor(Math.random() * items.length)];
            item.click();
        }
    }, amount);

    await page.click('.SubscribeButton');
    console.log("[Reddit] Waiting for navigation...");
    await page.waitForNavigation({ waitUntil: ['networkidle2'] });

    console.log(`[Reddit] Successfully registed!`);
    console.log(`[Save] Saving to file...`);
    await appendAccount(`${name}:jannasharplover${numbers}`);
    console.log(`[Save] Successfully saved...`);

    // const sitekey = await page.evaluate("___grecaptchaSiteKey");
    // console.log("Got sitekey from page:", sitekey);
    console.log(`[Browser] All done, closing...`);
    await browser.close();
})();