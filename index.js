const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 1010;

app.use(cors());

// --- Providers (Brasileiros - PT-BR Legendado/Dublado) ---

const GHOST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
};

// Gerar variações de slug para maximizar chances de achar no site BR
function generateSlugVariations(slug) {
    const base = slug.replace(/-dublado|-dub|-legendado|-todos-os-episodios/gi, '').replace(/-+$/, '');
    const variations = [
        slug,                    // original
        base,                    // sem sufixo
        `${base}-dublado`,       // com -dublado
        `${base}-legendado`,     // com -legendado
        `${base}-todos-os-episodios`, // formato antigo
    ];
    // Remover duplicatas
    return [...new Set(variations)];
}

const AnimeFireProvider = {
    name: 'VIP MASTER 1 [BRASIL] 🇧🇷',
    slug: 'anime-fire',
    async searchEpisode(slug, season, episode) {
        const domains = ['https://animefire.plus', 'https://animefire.net'];
        const slugs = generateSlugVariations(slug);

        for (const domain of domains) {
            for (const s of slugs) {
                try {
                    const url = `${domain}/video/${s}/${episode}`;
                    console.log(`[AnimeFire] Trying: ${url}`);
                    const response = await axios.get(url, {
                        headers: { ...GHOST_HEADERS, 'Referer': `${domain}/` },
                        timeout: 5000
                    });

                    // Formato JSON direto (mais comum)
                    if (response.data?.data?.[0]?.src) {
                        console.log(`[AnimeFire] FOUND via JSON: ${s}`);
                        return { error: false, episode: response.data.data[0].src };
                    }

                    // Formato HTML com video tag
                    const srcMatch = response.data.match(/src\s*[:=]\s*["']?(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/i);
                    if (srcMatch) {
                        console.log(`[AnimeFire] FOUND via regex: ${s}`);
                        return { error: false, episode: srcMatch[1] };
                    }
                } catch (e) { }
            }
        }
        return { error: true, episode: null };
    }
};

const AnimesOnlineCCProvider = {
    name: 'VIP MASTER 2 [BRASIL] 🇧🇷',
    slug: 'animes-online-cc',
    async searchEpisode(slug, season, episode) {
        const slugs = generateSlugVariations(slug);

        for (const s of slugs) {
            const urls = [
                `https://animesonlinecc.to/episodio/${s}-episodio-${episode}`,
                `https://animesonlinecc.to/episodio/${s}-${episode}`,
                `https://animesonlinecc.to/episodio/${s}`,
            ];

            for (const url of urls) {
                try {
                    console.log(`[AnimesOnlineCC] Trying: ${url}`);
                    const response = await axios.get(url, { headers: GHOST_HEADERS, timeout: 5000 });

                    // Buscar iframe com classe metaframe (player principal)
                    const metaMatch = response.data.match(/<iframe[^>]+class="metaframe[^"]*"[^>]+src="([^"]+)"/i);
                    if (metaMatch?.[1]) {
                        const src = metaMatch[1].startsWith('//') ? `https:${metaMatch[1]}` : metaMatch[1];
                        console.log(`[AnimesOnlineCC] FOUND metaframe: ${s}`);
                        return { error: false, episode: src };
                    }

                    // Fallback: qualquer iframe
                    const iframeMatch = response.data.match(/<iframe[^>]+src="([^"]+)"/i);
                    if (iframeMatch?.[1]) {
                        const src = iframeMatch[1].startsWith('//') ? `https:${iframeMatch[1]}` : iframeMatch[1];
                        console.log(`[AnimesOnlineCC] FOUND iframe: ${s}`);
                        return { error: false, episode: src };
                    }
                } catch (e) { }
            }
        }
        return { error: true, episode: null };
    }
};

// --- Resolve TMDB ID via AniList + MalSync (100% grátis, sem API key) ---
async function resolveTmdbId(title) {
    try {
        const cleanTitle = title
            .replace(/-dublado|-dub|-legendado|-todos-os-episodios/gi, '')
            .replace(/-/g, ' ')
            .trim();

        // Passo 1: Buscar no AniList para obter o MAL ID
        const query = `
            query ($search: String) {
                Media(search: $search, type: ANIME) {
                    id
                    idMal
                    title { english romaji }
                }
            }
        `;
        const aniRes = await axios.post('https://graphql.anilist.co', {
            query,
            variables: { search: cleanTitle }
        }, { timeout: 3000 });

        const media = aniRes.data?.data?.Media;
        if (!media?.idMal) return null;

        // Passo 2: Usar MalSync para converter MAL ID → TMDB ID
        const malSyncUrl = `https://api.malsync.moe/mal/anime/${media.idMal}`;
        const malRes = await axios.get(malSyncUrl, { timeout: 3000 });

        // MalSync retorna sites com TMDB entries
        const sites = malRes.data?.Sites;
        if (sites?.Tmdb) {
            const tmdbEntry = Object.values(sites.Tmdb)[0];
            if (tmdbEntry?.url) {
                // URL tipo: https://www.themoviedb.org/tv/62715
                const match = tmdbEntry.url.match(/\/(tv|movie)\/(\d+)/);
                if (match) return match[2];
            }
        }

        // Fallback: retornar o MAL ID (alguns players aceitam)
        return media.idMal.toString();
    } catch (e) {
        console.log('[Sugoi-Node] TMDB resolve error:', e.message);
    }
    return null;
}

// --- Routes ---

app.get('/', (req, res) => {
    res.json({
        name: "SugoiAPI Node Server",
        status: "Online",
        usage: "/api/episode/:slug/:season/:episodeNumber",
        example: "/api/episode/naruto/1/1"
    });
});

// Support both /api/episode and /episode routes
app.get(['/api/episode/:slug/:season/:episodeNumber', '/episode/:slug/:season/:episodeNumber'], async (req, res) => {
    const { slug, season, episodeNumber } = req.params;
    let tmdbId = req.query.tmdbId || '';
    const type = req.query.type || 'serie';
    const isMovie = type === 'movie';

    console.log(`[Sugoi-Node] Fetching: ${slug} | Season: ${season} | Ep: ${episodeNumber} | TMDB: ${tmdbId}`);

    // Resolve TMDB ID if not provided
    if (!tmdbId) {
        const resolved = await resolveTmdbId(slug);
        if (resolved) {
            tmdbId = resolved;
            console.log(`[Sugoi-Node] Resolved TMDB ID: ${tmdbId}`);
        }
    }

    const providers = [AnimeFireProvider, AnimesOnlineCCProvider];
    const results = [];

    for (const provider of providers) {
        try {
            const episodeData = await provider.searchEpisode(slug, season, episodeNumber);
            if (!episodeData.error && episodeData.episode) {
                results.push({
                    name: provider.name,
                    slug: provider.slug,
                    is_embed: provider.slug !== 'anime-fire',
                    episodes: [episodeData]
                });
            }
        } catch (err) { }
    }

    // SEMPRE adicionar servidores de embed
    if (tmdbId) {
        results.push({
            name: 'VIP MASTER Play [BR]',
            slug: 'smashy',
            is_embed: true,
            episodes: [{
                error: false,
                episode: isMovie
                    ? `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}`
                    : `https://embed.smashystream.com/playere.php?tmdb=${tmdbId}&season=${season}&episode=${episodeNumber}`
            }]
        });
        results.push({
            name: 'VIP MASTER 4K [BR]',
            slug: 'vidsrc-pm',
            is_embed: true,
            episodes: [{
                error: false,
                episode: isMovie
                    ? `https://vidsrc.pm/embed/movie/${tmdbId}`
                    : `https://vidsrc.pm/embed/tv/${tmdbId}/${season}/${episodeNumber}`
            }]
        });
        results.push({
            name: 'Global Play (HD)',
            slug: 'vidsrc-me',
            is_embed: true,
            episodes: [{
                error: false,
                episode: isMovie
                    ? `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`
                    : `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&sea=${season}&ep=${episodeNumber}`
            }]
        });
    }

    res.json({
        error: results.length === 0,
        message: results.length > 0 ? 'Success' : 'No sources found',
        tmdbId: tmdbId || null,
        data: results
    });
});

app.get('/proxy', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('No URL provided');

    try {
        console.log(`[Sugoi-Proxy] Fetching: ${url}`);

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Connection': 'keep-alive'
        };

        if (url.includes('lightspeedst.net')) {
            headers['Referer'] = 'https://animefire.plus/';
            headers['Origin'] = 'https://animefire.plus';
        } else if (url.includes('blogger.com') || url.includes('google.com')) {
            headers['Referer'] = 'https://www.blogger.com/';
        } else if (url.includes('animesonlinecc')) {
            headers['Referer'] = 'https://animesonlinecc.to/';
        }

        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            headers: headers,
            timeout: 10000
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');

        response.data.pipe(res);

        response.data.on('error', (err) => {
            console.error('[Sugoi-Proxy] Stream Error:', err.message);
            if (!res.headersSent) res.status(500).send('Stream error');
        });

    } catch (e) {
        console.error(`[Sugoi-Proxy] Error ${e.response?.status || 'Unknown'}:`, e.message);
        res.status(e.response?.status || 500).send(e.message);
    }
});

app.listen(PORT, () => {
    console.log(`\x1b[36m[SugoiAPI-Node] Running at http://localhost:${PORT}\x1b[00m`);
    console.log(`\x1b[33mPress Ctrl+C to stop.\x1b[00m`);
});
