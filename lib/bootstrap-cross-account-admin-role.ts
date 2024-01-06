import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class BootstrapAdminRole extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = this.node.tryGetContext("config")
    const accounts = config['accounts']

    new iam.Role(this, 'admin-role-from-cicd-account', {
      roleName: 'admin-role-from-cicd-account',
      assumedBy: new iam.CompositePrincipal(
        new iam.ArnPrincipal(`arn:aws:iam::${accounts['CICD_ACCOUNT_ID']}:role/RDSSchemaMigrationPipelineSynthRole`)
      ),
      description: 'Role to grant access to target accounts',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2FullAccess')
      ]
    });
  }
}
