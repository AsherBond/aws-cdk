import { Construct } from 'constructs';
import * as kms from '../../../aws-kms';
import * as s3 from '../../../aws-s3';
import * as cdk from '../../../core';
import { makeUniqueResourceName } from '../../../core/lib/private/unique-resource-name';
import { propertyInjectable } from '../../../core/lib/prop-injectable';

const REQUIRED_ALIAS_PREFIX = 'alias/';

/**
 * A class needed to work around CodePipeline's extremely small (100 characters)
 * limit for the name/ARN of the key in the ArtifactStore.
 * Limits the length of the alias' auto-generated name to 50 characters.
 */
@propertyInjectable
class AliasWithShorterGeneratedName extends kms.Alias {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-codepipeline.AliasWithShorterGeneratedName';

  protected generatePhysicalName(): string {
    let baseName = super.generatePhysicalName();
    if (baseName.startsWith(REQUIRED_ALIAS_PREFIX)) {
      // remove the prefix, because we're taking the last characters of the name below
      baseName = baseName.substring(REQUIRED_ALIAS_PREFIX.length);
    }
    const maxLength = 50 - REQUIRED_ALIAS_PREFIX.length;
    // take the last characters, as they include the hash,
    // and so have a higher chance of not colliding
    return REQUIRED_ALIAS_PREFIX + lastNCharacters(baseName, maxLength);
  }
}

function lastNCharacters(str: string, n: number) {
  const startIndex = Math.max(str.length - n, 0);
  return str.substring(startIndex);
}

/**
 * Props for the support stack
 */
export interface CrossRegionSupportConstructProps {
  /**
   * Whether to create the KMS CMK
   *
   * (Required for cross-account deployments)
   *
   * @default true
   */
  readonly createKmsKey?: boolean;

  /**
   * Enables KMS key rotation for cross-account keys.
   *
   * @default - false (key rotation is disabled)
   */
  readonly enableKeyRotation?: boolean;
}

export class CrossRegionSupportConstruct extends Construct {
  public readonly replicationBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: CrossRegionSupportConstructProps = {}) {
    super(scope, id);

    const createKmsKey = props.createKmsKey ?? true;

    let encryptionAlias;
    if (createKmsKey) {
      const encryptionKey = new kms.Key(this, 'CrossRegionCodePipelineReplicationBucketEncryptionKey', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        enableKeyRotation: props.enableKeyRotation,
      });
      encryptionAlias = new AliasWithShorterGeneratedName(this, 'CrossRegionCodePipelineReplicationBucketEncryptionAlias', {
        targetKey: encryptionKey,
        aliasName: cdk.PhysicalName.GENERATE_IF_NEEDED,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }
    this.replicationBucket = new s3.Bucket(this, 'CrossRegionCodePipelineReplicationBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      encryption: encryptionAlias ? s3.BucketEncryption.KMS : s3.BucketEncryption.KMS_MANAGED,
      encryptionKey: encryptionAlias,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });
  }
}

/**
 * Construction properties for `CrossRegionSupportStack`.
 * This interface is private to the aws-codepipeline package.
 */
export interface CrossRegionSupportStackProps {
  /**
   * The name of the Stack the Pipeline itself belongs to.
   * Used to generate a more friendly name for the support Stack.
   */
  readonly pipelineStackName: string;

  /**
   * The AWS region this Stack resides in.
   */
  readonly region: string;

  /**
   * The AWS account ID this Stack belongs to.
   *
   * @example '012345678901'
   */
  readonly account: string;

  readonly synthesizer: cdk.IStackSynthesizer | undefined;

  /**
   * Whether or not to create a KMS key in the support stack
   *
   * (Required for cross-account deployments)
   *
   * @default true
   */
  readonly createKmsKey?: boolean;

  /**
   * Enables KMS key rotation for cross-account keys.
   *
   * @default - false (key rotation is disabled)
   */
  readonly enableKeyRotation?: boolean;
}

/**
 * A Stack containing resources required for the cross-region CodePipeline functionality to work.
 * This class is private to the aws-codepipeline package.
 */
export class CrossRegionSupportStack extends cdk.Stack {
  /**
   * The name of the S3 Bucket used for replicating the Pipeline's artifacts into the region.
   */
  public readonly replicationBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: CrossRegionSupportStackProps) {
    super(scope, id, {
      stackName: generateStackName(props),
      env: {
        region: props.region,
        account: props.account,
      },
      synthesizer: props.synthesizer,
    });

    const crossRegionSupportConstruct = new CrossRegionSupportConstruct(this, 'Default', {
      createKmsKey: props.createKmsKey,
      enableKeyRotation: props.enableKeyRotation,
    });
    this.replicationBucket = crossRegionSupportConstruct.replicationBucket;
  }
}

function generateStackName(props: CrossRegionSupportStackProps): string {
  // When the pipeline stack name is an unresolved token, we generate stack name here
  // without including tokenized value in the generated stack name.
  if (cdk.Token.isUnresolved(props.pipelineStackName)) {
    return makeUniqueResourceName([`cross-region-support-${props.region}`], { maxLength: 128, allowedSpecialCharacters: '-' });
  }
  return `${props.pipelineStackName}-support-${props.region}`;
}
