const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 1010;

app.use(cors());

// --- Providers ---

const AnimeFireProvider = {
    name: 'VIP MASTER 1 [BRASIL]',
    slug: 'anime-fire',
    baseUrl: 'https://animefire.plus/video/',
    async searchEpisode(slug, season, episode) {
        const url = `${this.baseUrl}${slug}/${episode}`;
        try {
            const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });

            if (response.data && response.data.data) {
                return {
                    error: false,
                    episode: response.data.data[0].src
                };
            }
            return { error: true, episode: null };
        } catch (e) {
            return { error: true, episode: null };
        }
    }
};

const AnimesOnlineCCProvider = {
    name: 'VIP MASTER 2 [BRASIL]',
    slug: 'animes-online-cc',
    baseUrl: 'https://animesonlinecc.to/episodio/',
    async searchEpisode(slug, season, episode) {
        const url = `${this.baseUrl}${slug}-episodio-${episode}`;
        try {
            const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });

            const match = response.data.match(/<iframe.*?src="(.*?)".*?>/i);
            if (match && match[1]) {
                return {
                    error: false,
                    episode: match[1]
                };
            }
            return { error: true, episode: null };
        } catch (e) {
            return { error: true, episode: null };
        }
    }
};

// --- Resolve TMDB ID ---
async function resolveTmdbId(title) {
    try {
        const cleanTitle = title
            .replace(/-dublado|-dub|-legendado/gi, '')
            .replace(/-/g, ' ')
            .trim();

        const searchUrl = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(cleanTitle)}&language=pt-BR&api_key=d56e51fb77b081a9cb5192571b7c672d`;
        const res = await axios.get(searchUrl, { timeout: 3000 });
        if (res.data.results && res.data.results.length > 0) {
            return res.data.results[0].id.toString();
        }
        const movieUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(cleanTitle)}&language=pt-BR&api_key=d56e51fb77b081a9cb5192571b7c672d`;
        const movieRes = await axios.get(movieUrl, { timeout: 3000 });
        if (movieRes.data.results && movieRes.data.results.length > 0) {
            return movieRes.data.results[0].id.toString();
        }
    } catch (e) { }
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
