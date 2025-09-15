export const ANTHROPIC_HAIKU = "claude-3-5-haiku-20241022";
export const ANTHROPIC_SONNET_4 = "claude-sonnet-4-20250514";
export const ANTHROPIC_SONNET_3_5 = "claude-3-5-sonnet-20241022";

type AnthropicModel =
    | typeof ANTHROPIC_HAIKU
    | typeof ANTHROPIC_SONNET_4
    | typeof ANTHROPIC_SONNET_3_5;

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

export function getAnthropicClinet(model: AnthropicModel): AnthropicModel {
    if (!anthropicApiKey) {
        console.error('ANTHROPIC_API_KEY environment variable is not set.')
        process.exit(1);
    }
    else {
        return model;
    }
}
