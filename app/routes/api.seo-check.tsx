import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface Product {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string; // Added vendor to Product interface
  seo: {
    description: string;
  };
  variants: {
    nodes: {
      price: string;
      compareAtPrice: string;
      barcode: string;
    }[];
  };
  tags: string[];
  barcode?: string;
  metafields: {
    nodes: {
      key: string;
      value: string;
      namespace: string;
    }[];
  };
}

const fetchProducts = async (
  admin: any,
  count: number,
  cursor: string | null = null,
  query: string | null = null,
  sortKey: string = "CREATED_AT",
  reverse: boolean = false // Changed to false to attempt newest to oldest
): Promise<{ products: Product[]; pageInfo: any }> => {
  const response = await admin.graphql(
    `#graphql
      query someProducts($first: Int!, $cursor: String, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
        products(first: $first, after: $cursor, query: $query, sortKey: $sortKey, reverse: $reverse) {
          pageInfo {
            hasNextPage
            endCursor
            hasPreviousPage
            startCursor
          }
          nodes {
            id
            title
            handle
            descriptionHtml
            vendor # Added vendor to GraphQL query
            status
            seo {
              description
            }
            variants(first: 1) {
              nodes {
                id # Added variant ID
                price
                compareAtPrice
                barcode
              }
            }
            tags
            metafields(first: 10, namespace: "google_merchant_center") {
              nodes {
                key
                value
                namespace
              }
            }
          }
        }
      }`,
    {
      variables: {
        first: count,
        cursor: cursor,
        query: query,
        sortKey: sortKey,
        reverse: reverse,
      },
    }
  );

  const data = await response.json();
  if (data.errors) {
    console.error("GraphQL Errors:", data.errors);
    throw new Error(`Failed to fetch products from Shopify: ${JSON.stringify(data.errors)}`);
  }

  return {
    products: data.data.products.nodes,
    pageInfo: data.data.products.pageInfo,
  };
};

interface SeoIssue {
  message: string;
  severity: 'High' | 'Medium' | 'Low';
}

interface SeoSuggestion {
  suggestion: string;
  priority: 'High' | 'Medium' | 'Low';
}

interface SeoCheckResult {
  issues: SeoIssue[];
  suggestions_for_sales_improvement: SeoSuggestion[];
}

const checkSeo = (product: Product): SeoCheckResult => {
  const { title, descriptionHtml } = product;
  const issues: SeoIssue[] = [];
  const suggestions: SeoSuggestion[] = [];

  // Rule 0: Check for missing variants, which can cause other checks to fail
  if (!product.variants.nodes || product.variants.nodes.length === 0) {
    issues.push({
      message: "Product is missing variant information (price, etc.). This is a critical error.",
      severity: "High"
    });
    // Return early, as other checks will fail without variant data
    return { issues, suggestions_for_sales_improvement: suggestions };
  }

  // Rule 1: compareAtPrice must exist and be greater than price
  // Reverting to original string comparison for consistency with previous behavior
  if (product.variants.nodes[0]?.compareAtPrice === null || product.variants.nodes[0]?.compareAtPrice <= product.variants.nodes[0]?.price) {
    issues.push({
      message: "Google Merchant Center: compareAtPrice must exist and be greater than price.",
      severity: "High"
    });
    suggestions.push({
      suggestion: "Ensure 'compareAtPrice' is set and higher than 'price' for effective discount display and Google Merchant Center compliance.",
      priority: "High"
    });
  }

  // Rule 2: Product Title length (common SEO/GMC issue)
  const titleLength = product.title?.length || 0;
  if (titleLength > 70 && titleLength <= 150) {
    issues.push({
      message: `Product Title is slightly long (${titleLength} characters). Recommended length is 60-70 characters for optimal SEO display.`,
      severity: "Low" // Changed to Low since > 70 is very common and usually fine
    });
    suggestions.push({
      suggestion: "Consider shortening the product title to be concise and keyword-rich (ideally under 70 characters) to prevent truncation in search results.",
      priority: "Medium"
    });
  }
  if (titleLength > 150) { // GMC specific title length check
    issues.push({
      message: `Product Title is excessively long (${titleLength} characters) for Google Merchant Center (max 150 characters). It may be truncated or disapproved.`,
      severity: "High"
    });
    suggestions.push({
      suggestion: "Ensure product title is under 150 characters for Google Merchant Center compliance and optimal display.",
      priority: "High"
    });
  }

  // Rule 3: Basic keyword stuffing in title
  const titleLower = product.title?.toLowerCase();
  const keywordStuffingPatterns = ["case/cover", "protective case", "transparent", "clear", "iphone 11 pro"]; // Expanded patterns
  let foundKeywordStuffing = false;
  for (const pattern of keywordStuffingPatterns) {
    if (titleLower && titleLower.split(pattern).length > 2) { // Check for more than one occurrence
      foundKeywordStuffing = true;
      break;
    }
  }
  if (foundKeywordStuffing) {
    issues.push({
      message: "Product Title exhibits keyword stuffing and redundancy. This can negatively impact SEO readability and Google Merchant Center ad relevance.",
      severity: "High"
    });
    suggestions.push({
      suggestion: "Review product title for redundant keywords. Use natural language and prioritize unique selling points.",
      priority: "High"
    });
  }

  // Rule 4: Missing Meta Description
  const metaDescription = product.seo?.description || '';
  const descriptionHtmlText = product.descriptionHtml || '';
  // Strip script/style content (not just tags) before removing markup, so inline
  // JS/CSS never inflates or pollutes the description text.
  const descriptionText = descriptionHtmlText
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim() || '';

  if (metaDescription.trim() === '') {
    issues.push({
      message: "Meta Description is missing or empty. This is crucial for SEO click-through rates.",
      severity: "High"
    });
    suggestions.push({
      suggestion: "Craft a unique, compelling meta description (150-160 characters) that encourages clicks from search results.",
      priority: "High"
    });
  } else {
    // Rule 5: Meta Description Length (show error only if > 200 characters)
    const metaDescriptionLength = metaDescription.length;
    if (metaDescriptionLength > 200) {
      issues.push({
        message: `Meta Description is too long (${metaDescriptionLength} characters). It will be severely truncated in search results.`,
        severity: "High"
      });
      suggestions.push({
        suggestion: "Shorten the meta description to the recommended range of 150-160 characters for optimal display in search results.",
        priority: "High"
      });
    }
    // Rule: Meta Description is a direct copy of the product description snippet
    if (descriptionText.includes(metaDescription.trim()) && metaDescription.trim().length > 0) {
      issues.push({
        message: "Meta Description is a direct copy of the product description. This is a missed opportunity to craft unique, compelling ad copy for search results.",
        severity: "High"
      });
      suggestions.push({
        suggestion: "Write a unique, compelling meta description that acts as an enticing ad copy for search results, distinct from the product description.",
        priority: "High"
      });
    }
  }

  // Rule 6: Short Product Description (less than 50 characters)
  if (descriptionText.length < 50) {
    issues.push({
      message: `Product Description is very short (${descriptionText.length} characters). Detailed descriptions improve SEO and conversion.`,
      severity: "Low"
    });
    suggestions.push({
      suggestion: "Expand the product description with more details, features, benefits, and use cases to improve SEO and inform customers.",
      priority: "Medium"
    });
  }
  // Rule: Product Description lacks proper formatting (basic check for HTML tags)
  if (!/<[a-z][\s\S]*>/i.test(descriptionHtmlText) && descriptionText.length > 100) { // If no HTML tags and long text
    issues.push({
      message: "Product Description lacks proper formatting (e.g., headings, bullet points, paragraphs). It is presented as a single block of text.",
      severity: "High"
    });
    suggestions.push({
      suggestion: "Enhance product description formatting: Break down the text into easily digestible sections using proper HTML headings (H2, H3), bullet points for features/benefits, and short paragraphs.",
      priority: "High"
    });
  }

  // Rule 7: URL Handle Length (> 60 characters is long)
  const handleLength = product.handle?.length || 0;
  if (handleLength > 75) {
    issues.push({
      message: `Product URL handle is excessively long (${handleLength} characters). Shorter, keyword-rich, and user-friendly URLs are generally preferred for SEO and user experience.`,
      severity: "Medium"
    });
    suggestions.push({
      suggestion: "Refine product handle: Create a shorter, more SEO-friendly and user-friendly URL handle. If changing an existing URL, implement 301 redirects to preserve SEO value.",
      priority: "Medium"
    });
  }

  // Additional suggestions based on AI output, even if not directly checkable with current data
  if (!product.variants.nodes[0]?.barcode) {
    suggestions.push({
      suggestion: "Consider populating missing Google Merchant Center attributes like the GTIN (UPC/EAN/Barcode). If you do not have it, try using the GTIN Finder tool provided in the AI Auto-fix modal.",
      priority: "Medium"
    });
  }
  suggestions.push({
    suggestion: "Ensure recommended attributes are accurately provided in the product feed, including 'brand', 'google_product_category', 'color', 'material', and 'condition'.",
    priority: "Low"
  });
  suggestions.push({
    suggestion: "Implement Structured Data (Schema Markup): Add Product Schema markup to the product page to help search engines understand key product details and potentially lead to rich snippets in search results.",
    priority: "Medium"
  });
  suggestions.push({
    suggestion: "Integrate Customer Reviews: Prominently display customer reviews and ratings on the product page to build trust, provide social proof, and encourage purchases.",
    priority: "Low"
  });
  suggestions.push({
    suggestion: "Add High-Quality Media: Include multiple high-resolution images from various angles, lifestyle shots, and a product video demonstrating features and durability.",
    priority: "Low"
  });
  suggestions.push({
    suggestion: "Include a Clear Call to Action: Add a prominent and persuasive call to action within the product description and near the 'Add to Cart' button to guide users towards conversion.",
    priority: "Low"
  });
  suggestions.push({
    suggestion: "Develop a FAQ Section: Create a dedicated Frequently Asked Questions section on the product page to proactively address common customer queries, reduce support inquiries, and improve user confidence.",
    priority: "Low"
  });
  suggestions.push({
    suggestion: "Optimize for Google Ads: Develop specific, concise ad headlines and descriptions for Google Ads campaigns, tailored to character limits and designed for maximum impact and click-through rates.",
    priority: "Low"
  });

  return { issues, suggestions_for_sales_improvement: suggestions };
};

const getTotalProductCount = async (admin: any, query: string | null): Promise<number> => {
  const response = await admin.graphql(
    `#graphql
      query productsCount($query: String) {
        productsCount(query: $query) {
          count
        }
      }`,
    {
      variables: {
        query: query,
      },
    }
  );
  const data = await response.json();
  return data.data.productsCount.count;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  let cursor = url.searchParams.get("cursor") || null;
  const count = parseInt(url.searchParams.get("count") || "20", 10); // Default to 20 as per user request
  const query = url.searchParams.get("query") || null;
  const sortKey = url.searchParams.get("sortKey") || "CREATED_AT";
  // If sortKey is CREATED_AT, default reverse to false for newest first, otherwise use true for alphabetical Z-A or other descending
  const reverse = sortKey === "CREATED_AT" ? (url.searchParams.get("reverse") === "true" ? true : false) : (url.searchParams.get("reverse") || "true") === "true";
  const isDashboardRequest = url.searchParams.get("dashboard") === "true";
  if (!session) {
    console.error("SEO Check Loader - Unauthorized: No session found.");
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let fetchedProducts: Product[] = [];
    let totalCount = 0;
    let finalPageInfo: any = {};

    const [{ products, pageInfo }, totalProductsCount] = await Promise.all([
      fetchProducts(admin, count, cursor, query, sortKey, reverse),
      getTotalProductCount(admin, query),
    ]);

    const productIds = products.map((p) => p.id);
    const savedAiChecks = await prisma.productAICheck.findMany({
      where: {
        shop: session.shop,
        productId: { in: productIds }
      }
    });

    const savedAiChecksMap = new Map();
    savedAiChecks.forEach((check: { productId: string; }) => {
      savedAiChecksMap.set(check.productId, check);
    });

    fetchedProducts = products.map(product => {
      if (savedAiChecksMap.has(product.id)) {
        const savedCheck = savedAiChecksMap.get(product.id);
        const result = savedCheck.result as any;
        return {
          ...product,
          issues: result?.issues || [],
          suggestions_for_sales_improvement: result?.suggestions_for_sales_improvement || [],
        };
      }

      const { issues, suggestions_for_sales_improvement } = checkSeo(product);
      return {
        ...product,
        issues: issues,
        suggestions_for_sales_improvement: suggestions_for_sales_improvement,
      };
    });
    
    totalCount = totalProductsCount;
    finalPageInfo = pageInfo;

    return json({ products: fetchedProducts, pageInfo: finalPageInfo, totalCount });
  } catch (error: any) {
    console.error("SEO Check Loader - Error fetching products:", error?.message, error?.stack);
    return json({ error: 'Failed to fetch products', details: error.message }, { status: 500 });
  }
}
