-- The Kie.ai usage skill tells a coworker what to do when Kie.ai refuses a call, instead of retrying
-- it as it was: an input file it cannot read (an image from a social network CDN) goes through
-- upload_file, a credit or key error goes to the user, and a failed submit_media_generation, which
-- never says why, is read by calling the item's tool directly. The tool list names gpt_image, the
-- name the server gives it. A coworker gets it when its services are next compiled.
update public.services
   set manifest = manifest || jsonb_build_object(
         'skills', jsonb_build_array(jsonb_build_object(
           'name', 'kie-ai-usage', 'description', 'How to use the Kie.ai MCP tools',
           'body', '# Kie.ai' || E'\n\n' ||
             'Kie.ai exposes one tool per media model: images (nano_banana_image, gpt_image, flux2_image, bytedance_seedream_image, midjourney_generate, qwen_image, z_image), video (veo3_generate_video, kling_video, bytedance_seedance_video, runway_aleph_video, wan_video, hailuo_video), audio (suno_generate_music, elevenlabs_tts, elevenlabs_ttsfx) and editing (topaz_upscale_image, recraft_remove_background, ideogram_reframe).' || E'\n\n' ||
             '## Workflow' || E'\n' ||
             '1. Not sure which model fits? Call list_models to search by capability.' || E'\n' ||
             '2. Input images or audio must be public URLs. For a local file, call upload_file (base64) first and pass the returned URL.' || E'\n' ||
             '3. Generation is asynchronous: the tool returns a task_id. Call wait_for_task (or poll get_task_status) until it succeeds, then read the output URLs.' || E'\n' ||
             '4. Output URLs expire: download the files you want to keep into the workspace.' || E'\n\n' ||
             '## When a call fails' || E'\n' ||
             'Read the error the tool returns and act on it. Never send the same call again unchanged.' || E'\n' ||
             '- "File type not supported", or an input file Kie.ai cannot read (an image from a social network CDN, a URL without a usual file extension): download the file into the workspace, send it with upload_file (file_base64), then call again with the URL it returns.' || E'\n' ||
             '- An error about credits, the API key or authentication: tell the user what Kie.ai said. A retry fails the same way.' || E'\n' ||
             '- submit_media_generation only says "One or more plan items failed", not why. Call the tool of a failed item directly, once, with the same arguments, to read the reason.' || E'\n\n' ||
             '## Cost' || E'\n' ||
             'Every generation spends the user''s Kie.ai credits, and video is the most expensive. Generate one variant first, and only batch or retry when the user asked for it.'
         ))
       ),
       updated_at = now()
 where slug = 'kie-ai';
